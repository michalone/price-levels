import {
    reactExtension,
    useApi,
    AdminBlock,
    Banner,
    BlockStack,
    Box,
    Button,
    Checkbox,
    Divider,
    InlineStack,
    ProgressIndicator,
    Text,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useState } from "react";

const TARGET = "admin.draft-order-details.block.render";
const METAFIELD_NAMESPACE = "$app:pricing";
const METAFIELD_KEY = "individual_price_lines";

export default reactExtension(TARGET, () => <App />);

interface Money {
    amount: string;
    currencyCode: string;
}

interface LineItem {
    id: string;
    title: string;
    variantTitle: string | null;
    quantity: number;
    originalUnitPriceSet: { presentmentMoney: Money } | null;
    approximateDiscountedUnitPriceSet: { presentmentMoney: Money } | null;
    variant: { id: string } | null;
    standardPrice?: Money | null;
}

interface LoadResult {
    draftOrder: {
        id: string;
        flags: { value: string } | null;
        shippingAddress: { countryCodeV2: string | null } | null;
        billingAddress: { countryCodeV2: string | null } | null;
        lineItems: { nodes: LineItem[] };
    } | null;
}

interface ContextualPricingResult {
    nodes: Array<{
        id: string;
        contextualPricing?: { price: Money } | null;
        presentmentPrices?: {
            nodes: Array<{
                price: Money;
            }>;
        } | null;
    } | null>;
}

interface SaveResult {
    metafieldsSet: {
        userErrors: Array<{ field: string[] | null; message: string }>;
    };
}

function formatMoney(money: Money | null | undefined): string {
    if (!money) return "";
    return `${money.amount} ${money.currencyCode}`;
}

function getOrderUnitPrice(li: LineItem): Money | null {
    return li.approximateDiscountedUnitPriceSet?.presentmentMoney ?? li.originalUnitPriceSet?.presentmentMoney ?? null;
}

function isPriceDifferent(standard: Money | null | undefined, order: Money | null | undefined): boolean {
    if (!standard || !order) return false;
    if (standard.currencyCode !== order.currencyCode) return false;
    const a = parseFloat(standard.amount);
    const b = parseFloat(order.amount);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return Math.abs(a - b) > 0.01;
}

function lineLabel(li: LineItem): string {
    return li.variantTitle ? `${li.title} - ${li.variantTitle}` : li.title;
}

function App() {
    const { data, query, i18n } = useApi(TARGET);
    const draftOrderId = data.selected[0]?.id;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineItem[]>([]);
    const [flags, setFlags] = useState<Record<string, boolean>>({});
    const [message, setMessage] = useState("");

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function load() {
        if (!draftOrderId) return;
        setLoading(true);
        setMessage("");

        try {
            const draftRes = await query<LoadResult>(
                `query GetDraft($id: ID!) {
          draftOrder(id: $id) {
            id
            flags: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
              value
            }
            shippingAddress { countryCodeV2 }
            billingAddress { countryCodeV2 }
            lineItems(first: 100) {
              nodes {
                id
                title
                variantTitle
                quantity
                originalUnitPriceSet { presentmentMoney { amount currencyCode } }
                approximateDiscountedUnitPriceSet { presentmentMoney { amount currencyCode } }
                variant { id }
              }
            }
          }
        }`,
                { variables: { id: draftOrderId } },
            );

            const draftErrors = (draftRes as { errors?: Array<{ message: string }> })?.errors;
            if (draftErrors?.length) {
                setMessage(`GraphQL: ${draftErrors.map((e) => e.message).join("; ")}`);
            }

            const draft = draftRes?.data?.draftOrder ?? null;
            if (!draft) {
                setLines([]);
                setFlags({});
                setMessage((m) => m || `draftOrder is null. id=${String(draftOrderId)}`);
                return;
            }

            const country = draft.shippingAddress?.countryCodeV2 ?? draft.billingAddress?.countryCodeV2 ?? null;
            const variantIds = Array.from(
                new Set(
                    (draft.lineItems?.nodes ?? [])
                        .map((li) => li.variant?.id)
                        .filter((id): id is string => Boolean(id)),
                ),
            );

            const priceByVariant = new Map<string, Money>();
            if (country && variantIds.length) {
                const ctxRes = await query<ContextualPricingResult>(
                    `query GetContextualPrices($ids: [ID!]!, $country: CountryCode!) {
              nodes(ids: $ids) {
                ... on ProductVariant {
                  id
                  contextualPricing(context: { country: $country }) {
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }`,
                    { variables: { ids: variantIds, country } },
                );

                const ctxErrors = (ctxRes as { errors?: Array<{ message: string }> })?.errors;
                if (ctxErrors?.length) {
                    setMessage(`GraphQL: ${ctxErrors.map((e) => e.message).join("; ")}`);
                }

                for (const node of ctxRes?.data?.nodes ?? []) {
                    if (node?.id && node.contextualPricing?.price) {
                        priceByVariant.set(node.id, node.contextualPricing.price);
                    }
                }
            }

            // Fallback: if we cannot resolve a market country (or contextual pricing
            // returned no value), resolve standard price by the draft's presentment
            // currency via presentmentPrices.
            const orderCurrency = (draft.lineItems?.nodes ?? [])
                .map((li) => getOrderUnitPrice(li)?.currencyCode)
                .find((c): c is string => Boolean(c));

            if (variantIds.length && orderCurrency) {
                const missingVariantIds = variantIds.filter((id) => !priceByVariant.has(id));
                if (missingVariantIds.length) {
                    const presentmentRes = await query<ContextualPricingResult>(
                        `query GetPresentmentPrices($ids: [ID!]!, $currencies: [CurrencyCode!]) {
                            nodes(ids: $ids) {
                                ... on ProductVariant {
                                    id
                                    presentmentPrices(first: 1, presentmentCurrencies: $currencies) {
                                        nodes {
                                            price {
                                                amount
                                                currencyCode
                                            }
                                        }
                                    }
                                }
                            }
                        }`,
                        { variables: { ids: missingVariantIds, currencies: [orderCurrency] } },
                    );

                    const presentmentErrors = (presentmentRes as { errors?: Array<{ message: string }> })?.errors;
                    if (presentmentErrors?.length) {
                        setMessage(`GraphQL: ${presentmentErrors.map((e) => e.message).join("; ")}`);
                    }

                    for (const node of presentmentRes?.data?.nodes ?? []) {
                        const price = node?.presentmentPrices?.nodes?.[0]?.price;
                        if (node?.id && price) {
                            priceByVariant.set(node.id, price);
                        }
                    }
                }
            }

            const enriched = (draft.lineItems?.nodes ?? []).map((li) => ({
                ...li,
                standardPrice: li.variant ? priceByVariant.get(li.variant.id) ?? null : null,
            }));

            const filtered = enriched.filter((li) =>
                isPriceDifferent(li.standardPrice, getOrderUnitPrice(li)),
            );

            let stored: Record<string, boolean> = {};
            if (draft.flags?.value) {
                try {
                    stored = JSON.parse(draft.flags.value);
                } catch {
                    stored = {};
                }
            }

            const initialFlags: Record<string, boolean> = {};
            for (const li of filtered) {
                initialFlags[li.id] = stored[li.id] ?? false;
            }

            setLines(filtered);
            setFlags(initialFlags);

            if (!country && filtered.length === 0 && !message) {
                setMessage("Standard price could not be resolved by market country on this draft.");
            }
        } catch (e) {
            setMessage(`${i18n.translate("loadError")} ${String(e)}`);
        } finally {
            setLoading(false);
        }
    }

    async function save() {
        if (!draftOrderId) return;
        setSaving(true);
        setMessage("");

        try {
            const res = await query<SaveResult>(
                `mutation SetFlags($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }`,
                {
                    variables: {
                        metafields: [
                            {
                                ownerId: draftOrderId,
                                namespace: METAFIELD_NAMESPACE,
                                key: METAFIELD_KEY,
                                type: "json",
                                value: JSON.stringify(flags),
                            },
                        ],
                    },
                },
            );

            const errs = res?.data?.metafieldsSet?.userErrors ?? [];
            setMessage(errs.length ? errs[0].message : i18n.translate("saved"));
        } catch (e) {
            setMessage(`${i18n.translate("saveFailed")} ${String(e)}`);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <AdminBlock title={i18n.translate("title")}>
                <InlineStack inlineAlignment="center">
                    <ProgressIndicator size="small-200" />
                </InlineStack>
            </AdminBlock>
        );
    }

    return (
        <AdminBlock title={i18n.translate("title")}>
            <BlockStack gap="base">
                {lines.length === 0 ? (
                    <Banner tone="info">{i18n.translate("noChanges")}</Banner>
                ) : (
                    <BlockStack gap="base">
                        <Text>{i18n.translate("intro")}</Text>
                        <BlockStack gap="small">
                            <InlineStack gap="base" blockAlignment="center">
                                <Box inlineSize="40%">
                                    <Text fontWeight="bold">{i18n.translate("colProduct")}</Text>
                                </Box>
                                <Box inlineSize="18%">
                                    <Text fontWeight="bold">{i18n.translate("colStandard")}</Text>
                                </Box>
                                <Box inlineSize="18%">
                                    <Text fontWeight="bold">{i18n.translate("colNew")}</Text>
                                </Box>
                                <Box inlineSize="22%">
                                    <Text fontWeight="bold">{i18n.translate("colIndividual")}</Text>
                                </Box>
                            </InlineStack>
                            <Divider />

                            {lines.map((li, index) => {
                                const checked = flags[li.id] ?? false;
                                return (
                                    <BlockStack key={li.id} gap="small">
                                        {index > 0 ? <Divider /> : null}
                                        <InlineStack gap="base" blockAlignment="center">
                                            <Box inlineSize="40%">
                                                <Text>{lineLabel(li)}</Text>
                                            </Box>
                                            <Box inlineSize="18%">
                                                <Text>{formatMoney(li.standardPrice)}</Text>
                                            </Box>
                                            <Box inlineSize="18%">
                                                <Text>{formatMoney(getOrderUnitPrice(li))}</Text>
                                            </Box>
                                            <Box inlineSize="22%">
                                                <InlineStack gap="small" blockAlignment="center">
                                                    <Checkbox
                                                        accessibilityLabel={`${i18n.translate("colIndividual")}: ${lineLabel(li)}`}
                                                        checked={checked}
                                                        onChange={(value: boolean) =>
                                                            setFlags((prev) => ({ ...prev, [li.id]: value }))
                                                        }
                                                    />
                                                    <Text>{checked ? i18n.translate("yes") : i18n.translate("no")}</Text>
                                                </InlineStack>
                                            </Box>
                                        </InlineStack>
                                    </BlockStack>
                                );
                            })}
                        </BlockStack>
                    </BlockStack>
                )}

                <InlineStack gap="base">
                    <Button variant="primary" disabled={saving} onClick={save}>
                        {i18n.translate("save")}
                    </Button>
                    <Button disabled={loading} onClick={load}>
                        {i18n.translate("refresh")}
                    </Button>
                </InlineStack>

                {message ? <Text>{message}</Text> : null}
            </BlockStack>
        </AdminBlock>
    );
}
