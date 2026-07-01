import { useEffect, useRef, useState } from "react";
import type {
    ActionFunctionArgs,
    HeadersFunction,
    LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { useFetcher, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:supplier_price_list";
const PRICE_LEVEL_TYPE = "$app:price_level";
const PARTNER_TYPE = "$app:partner";

interface Company {
    id: string;
    name: string;
}

interface CompaniesResponse {
    data?: {
        companies?: {
            edges: Array<{
                node: {
                    id: string;
                    name: string;
                };
            }>;
        };
    };
}

type FieldMap = Record<string, string>;

interface PriceLevel {
    id: string;
    handle: string;
    displayName: string;
    name: string;
}

interface MetaobjectMutationResponse {
    data?: {
        result?: {
            metaobject?: { id: string } | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
        } | null;
    };
}

interface PriceLevelsResponse {
    data?: {
        metaobjects?: {
            edges: Array<{
                node: {
                    id: string;
                    handle: string;
                    displayName: string;
                    fields: Array<{ key: string; value: string | null }>;
                };
            }>;
        };
    };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    const [levelsResponse, companiesResponse] = await Promise.all([
        admin.graphql(
            `#graphql
        query PriceLevels($type: String!) {
          metaobjects(type: $type, first: 100) {
            edges {
              node {
                id
                handle
                displayName
                fields {
                  key
                  value
                }
              }
            }
          }
        }`,
            { variables: { type: PRICE_LEVEL_TYPE } },
        ),
        admin.graphql(
            `#graphql
        query Companies {
          companies(first: 100) {
            edges {
              node {
                id
                name
              }
            }
          }
        }`,
        ),
    ]);

    const levelsJson = (await levelsResponse.json()) as PriceLevelsResponse;
    const levelsEdges = levelsJson.data?.metaobjects?.edges ?? [];

    const levels: PriceLevel[] = levelsEdges.map(({ node }) => {
        const fields: Record<string, string> = {};
        for (const f of node.fields) {
            fields[f.key] = f.value ?? "";
        }
        return {
            id: node.id,
            handle: node.handle,
            displayName: node.displayName,
            name: fields.name || node.displayName,
        };
    });

    const companiesJson = (await companiesResponse.json()) as CompaniesResponse;
    const companiesEdges = companiesJson.data?.companies?.edges ?? [];

    const companies: Company[] = companiesEdges.map(({ node }) => ({
        id: node.id,
        name: node.name,
    }));

    return { levels, companies };
};

const FIELD_KEYS = ["name", "supplier", "columns", "valid_from", "valid_to"] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const columns = String(formData.get("columns") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "" && item.startsWith("gid://"));

    const fields = FIELD_KEYS.map((key) => {
        if (key === "columns") {
            if (columns.length === 0) {
                return null;
            }
            // For list.metaobject_reference, send as JSON array
            return { key, value: JSON.stringify(columns) };
        }
        const value = String(formData.get(key) ?? "").trim();
        return value ? { key, value } : null;
    }).filter((field) => field !== null) as Array<{ key: string; value: string }>;

    console.log("Creating price list with fields:", fields);

    const response = await admin.graphql(
        `#graphql
    mutation CreatePriceList($metaobject: MetaobjectCreateInput!) {
      result: metaobjectCreate(metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`,
        { variables: { metaobject: { type: METAOBJECT_TYPE, fields } } },
    );
    const json = (await response.json()) as MetaobjectMutationResponse;
    const errors = json.data?.result?.userErrors ?? [];
    if (errors.length > 0) {
        console.error("Metaobject creation errors:", errors);
    }
    return { ok: errors.length === 0, errors };
};

const EMPTY_FORM: FieldMap = {
    name: "",
    supplier: "",
    columns: "",
    valid_from: "",
    valid_to: "",
};

export default function NewPriceList() {
    const { levels, companies } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const navigate = useNavigate();
    const t = useTranslation();

    const [form, setForm] = useState<FieldMap>(EMPTY_FORM);
    const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
    const hasNavigated = useRef(false);
    const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data && !hasNavigated.current) {
            if (fetcher.data.ok) {
                hasNavigated.current = true;
                shopify.toast.show(t("priceLists.toastCreated"));
                navigate("/app/price-lists");
            } else if (fetcher.data.errors?.length) {
                shopify.toast.show(fetcher.data.errors[0].message, { isError: true });
            }
        }
    }, [fetcher.state, fetcher.data]);

    const setField = (key: string, value: string) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const handleColumnToggle = (levelId: string) => {
        const newSelected = new Set(selectedColumns);
        if (newSelected.has(levelId)) {
            newSelected.delete(levelId);
        } else {
            newSelected.add(levelId);
        }
        setSelectedColumns(newSelected);
        setField("columns", Array.from(newSelected).join(","));
    };

    const save = () => {
        const payload: Record<string, string> = {};
        for (const key of Object.keys(form)) {
            if (form[key] !== "") payload[key] = form[key];
        }
        fetcher.submit(payload, { method: "POST" });
    };

    const cancel = () => {
        navigate("/app/price-lists");
    };

    return (
        <s-page heading={t("priceLists.formNew")}>
            <s-button
                slot="primary-action"
                variant="primary"
                onClick={cancel}
            >
                {t("action.cancel")}
            </s-button>

            <s-section heading={t("priceLists.formNew")}>
                <s-stack direction="block" gap="base">
                    <s-text-field
                        label={t("field.name")}
                        name="name"
                        value={form.name}
                        onChange={(e) => setField("name", (e.target as HTMLInputElement).value)}
                    />
                    <s-select
                        label={t("field.supplier")}
                        name="supplier"
                        value={form.supplier}
                        onChange={(e) => setField("supplier", (e.target as HTMLSelectElement).value)}
                    >
                        <s-option value="">-- {t("action.select")} --</s-option>
                        {companies.map((company) => (
                            <s-option key={company.id} value={company.id}>
                                {company.name}
                            </s-option>
                        ))}
                    </s-select>
                    <div style={{ marginBottom: "16px" }}>
                        <label style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}>
                            {t("field.columns")}
                        </label>
                        {levels.map((level) => (
                            <div key={level.id} style={{ marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                                <s-checkbox
                                    checked={selectedColumns.has(level.id)}
                                    onChange={() => handleColumnToggle(level.id)}
                                    id={`col-${level.id}`}
                                />
                                <label htmlFor={`col-${level.id}`} style={{ cursor: "pointer", margin: 0 }}>
                                    {level.name}
                                </label>
                            </div>
                        ))}
                    </div>
                    <div style={{ marginBottom: "16px" }}>
                        <label htmlFor="valid_from" style={{ display: "block", marginBottom: "4px", fontWeight: "500" }}>
                            {t("field.validFrom")}
                        </label>
                        <input
                            id="valid_from"
                            type="date"
                            name="valid_from"
                            value={form.valid_from}
                            onChange={(e) => setField("valid_from", e.target.value)}
                            style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "100%" }}
                        />
                    </div>
                    <div style={{ marginBottom: "16px" }}>
                        <label htmlFor="valid_to" style={{ display: "block", marginBottom: "4px", fontWeight: "500" }}>
                            {t("field.validTo")}
                        </label>
                        <input
                            id="valid_to"
                            type="date"
                            name="valid_to"
                            value={form.valid_to}
                            onChange={(e) => setField("valid_to", e.target.value)}
                            style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc", width: "100%" }}
                        />
                    </div>

                    <s-stack direction="inline" gap="base">
                        <s-button
                            variant="primary"
                            onClick={save}
                            {...(isSubmitting ? { loading: true } : {})}
                        >
                            {t("action.create")}
                        </s-button>
                        <s-button variant="tertiary" onClick={cancel}>
                            {t("action.cancel")}
                        </s-button>
                    </s-stack>
                </s-stack>
            </s-section>
        </s-page>
    );
}

export function ErrorBoundary() {
    return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
    return boundary.headers(headersArgs);
};
