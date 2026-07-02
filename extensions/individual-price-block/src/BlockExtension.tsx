import {
    reactExtension,
    useApi,
    AdminBlock,
    BlockStack,
    InlineStack,
    Box,
    Divider,
    Text,
    Checkbox,
    Button,
    Banner,
    ProgressIndicator,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useState } from "react";

const TARGET = "admin.draft-order-details.block.render";

// App-owned draft order metafield holding the per-line "save as individual
// price" flags. Stored as a JSON map { draftOrderLineItemId: boolean }.
const METAFIELD_NAMESPACE = "$app:pricing";
const METAFIELD_KEY = "individual_price_lines";

export default reactExtension(TARGET, () => <App />);

interface Money {
    amount: string;
    currencyCode: string;
}

interface AppliedDiscount {
    value: number;
    valueType: string;
    title: string | null;
    amountSet: { shopMoney: Money } | null;
}

interface LineItem {
    id: string;
    title: string;
    variantTitle: string | null;
    quantity: number;
    originalUnitPriceSet: { shopMoney: Money } | null;
    discountedUnitPriceSet: { shopMoney: Money } | null;
    appliedDiscount: AppliedDiscount | null;
}

interface LoadResult {
    draftOrder: {
        id: string;
        flags: { value: string } | null;
        lineItems: { nodes: LineItem[] };
    } | null;
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

// A line has a manually changed price when either an applied discount is
// present, or the discounted unit price differs from the original unit price.
function isPriceChanged(li: LineItem): boolean {
    if (li.appliedDiscount != null) return true;
    const original = parseFloat(li.originalUnitPriceSet?.shopMoney?.amount ?? "");
    const discounted = parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount ?? "");
    if (!Number.isNaN(original) && !Number.isNaN(discounted) && original !== discounted) {
        return true;
    }
    return false;
}

function App() {
    const { data, query, i18n } = useApi(TARGET);
    const draftOrderId = data.selected[0]?.id;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [lines, setLines] = useState<LineItem[]>([]);
    const [totalLines, setTotalLines] = useState(0);
    const [flags, setFlags] = useState<Record<string, boolean>>({});
    const [message, setMessage] = useState("");

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function load() {
        setLoading(true);
        setMessage("");
        try {
            const res = await query<LoadResult>(
                `query GetDraft($id: ID!) {
          draftOrder(id: $id) {
            id
            flags: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
              value
            }
            lineItems(first: 100) {
              nodes {
                id
                title
                variantTitle
                quantity
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                discountedUnitPriceSet { shopMoney { amount currencyCode } }
                appliedDiscount {
                  value
                  valueType
                  title
                  amountSet { shopMoney { amount currencyCode } }
                }
              }
            }
          }
        }`,
                { variables: { id: draftOrderId } },
            );

            const draft = res?.data?.draftOrder ?? null;
            const allLines = draft?.lineItems?.nodes ?? [];
            const changed = allLines.filter(isPriceChanged);
            setTotalLines(allLines.length);
            setLines(changed);

            let stored: Record<string, boolean> = {};
            if (draft?.flags?.value) {
                try {
                    stored = JSON.parse(draft.flags.value);
                } catch {
                    stored = {};
                }
            }
            const initial: Record<string, boolean> = {};
            for (const li of changed) {
                initial[li.id] = stored[li.id] ?? false;
            }
            setFlags(initial);
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
            setMessage(i18n.translate("saveFailed"));
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
                    <BlockStack gap="base">
                        <Banner tone="info">{i18n.translate("noChanges")}</Banner>
                        <Text>{i18n.translate("diagnostic", { total: totalLines })}</Text>
                        <Button disabled={loading} onClick={load}>
                            {i18n.translate("refresh")}
                        </Button>
                    </BlockStack>
                ) : (
                    <BlockStack gap="base">
                        <Text>{i18n.translate("intro")}</Text>
                        {lines.map((li, index) => (
                            <BlockStack key={li.id} gap="base">
                                {index > 0 ? <Divider /> : null}
                                <InlineStack inlineAlignment="space-between" blockAlignment="center">
                                    <BlockStack gap="none">
                                        <Text fontWeight="bold">
                                            {li.variantTitle ? `${li.title} – ${li.variantTitle}` : li.title}
                                        </Text>
                                        <Text>{i18n.translate("quantity", { qty: li.quantity })}</Text>
                                        <Text>
                                            {i18n.translate("originalPrice", {
                                                price: formatMoney(li.originalUnitPriceSet?.shopMoney),
                                            })}
                                        </Text>
                                        <Text>
                                            {i18n.translate("newPrice", {
                                                price: formatMoney(li.discountedUnitPriceSet?.shopMoney),
                                            })}
                                        </Text>
                                        {li.appliedDiscount?.amountSet?.shopMoney ? (
                                            <Text>
                                                {i18n.translate("discountAmount", {
                                                    amount: formatMoney(li.appliedDiscount.amountSet.shopMoney),
                                                })}
                                            </Text>
                                        ) : null}
                                    </BlockStack>
                                    <Box>
                                        <Checkbox
                                            label={i18n.translate("toggle")}
                                            checked={flags[li.id] ?? false}
                                            onChange={(value: boolean) =>
                                                setFlags((prev) => ({ ...prev, [li.id]: value }))
                                            }
                                        />
                                    </Box>
                                </InlineStack>
                            </BlockStack>
                        ))}
                        <Button variant="primary" disabled={saving} onClick={save}>
                            {i18n.translate("save")}
                        </Button>
                        <Button disabled={loading} onClick={load}>
                            {i18n.translate("refresh")}
                        </Button>
                    </BlockStack>
                )}
                {message ? <Text>{message}</Text> : null}
            </BlockStack>
        </AdminBlock>
    );
}
