import { useEffect, useRef, useState } from "react";
import type {
    ActionFunctionArgs,
    HeadersFunction,
    LoaderFunctionArgs,
} from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:supplier_price_list";
const PRICE_LEVEL_TYPE = "$app:price_level";

type FieldMap = Record<string, string>;

interface PriceLevel {
    id: string;
    handle: string;
    displayName: string;
    name: string;
}

interface Company {
    id: string;
    name: string;
}

interface PriceList {
    id: string;
    displayName: string;
    fields: FieldMap;
}

interface MetaobjectsQueryResponse {
    data?: {
        metaobject?: {
            id: string;
            displayName: string;
            fields: Array<{ key: string; value: string | null }>;
        };
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

interface MetaobjectMutationResponse {
    data?: {
        result?: {
            metaobject?: { id: string } | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
        } | null;
    };
}

const FIELD_KEYS = ["name", "supplier", "columns", "valid_from", "valid_to"] as const;

function columnsFieldToText(raw: string) {
    if (!raw || !raw.trim()) return "";
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
            return parsed.length > 0 ? `${parsed.length} price level(s)` : "";
        }
    } catch (error) {
        // Ignore parse errors
    }
    return "";
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const { id } = params;

    const [listResponse, levelsResponse, companiesResponse] = await Promise.all([
        admin.graphql(
            `#graphql
        query PriceList($id: ID!) {
          metaobject(id: $id) {
            id
            displayName
            fields {
              key
              value
            }
          }
        }`,
            { variables: { id: `gid://shopify/Metaobject/${id}` } },
        ),
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

    const listJson = (await listResponse.json()) as MetaobjectsQueryResponse;
    const node = listJson.data?.metaobject;

    if (!node) {
        throw new Response("Not found", { status: 404 });
    }

    const fields: FieldMap = {};
    for (const f of node.fields) {
        fields[f.key] = f.value ?? "";
    }

    const list: PriceList = {
        id: node.id,
        displayName: node.displayName,
        fields,
    };

    const levelsJson = (await levelsResponse.json()) as PriceLevelsResponse;
    const levelsEdges = levelsJson.data?.metaobjects?.edges ?? [];

    const levels: PriceLevel[] = levelsEdges.map(({ node }) => {
        const levelFields: Record<string, string> = {};
        for (const f of node.fields) {
            levelFields[f.key] = f.value ?? "";
        }
        return {
            id: node.id,
            handle: node.handle,
            displayName: node.displayName,
            name: levelFields.name || node.displayName,
        };
    });

    const companiesJson = (await companiesResponse.json()) as CompaniesResponse;
    const companiesEdges = companiesJson.data?.companies?.edges ?? [];

    const companies: Company[] = companiesEdges.map(({ node }) => ({
        id: node.id,
        name: node.name,
    }));

    return { list, levels, companies };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const { id } = params;
    const formData = await request.formData();
    const intent = String(formData.get("intent") ?? "save");

    if (intent === "delete") {
        const response = await admin.graphql(
            `#graphql
      mutation DeletePriceList($id: ID!) {
        result: metaobjectDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }`,
            { variables: { id: `gid://shopify/Metaobject/${id}` } },
        );
        const json = (await response.json()) as MetaobjectMutationResponse;
        const errors = json.data?.result?.userErrors ?? [];
        if (errors.length === 0) {
            return redirect("/app/price-lists");
        }
        return { ok: false, errors, isDelete: true };
    }

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

    const response = await admin.graphql(
        `#graphql
    mutation UpdatePriceList($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      result: metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`,
        { variables: { id: `gid://shopify/Metaobject/${id}`, metaobject: { fields } } },
    );
    const json = (await response.json()) as MetaobjectMutationResponse;
    const errors = json.data?.result?.userErrors ?? [];
    return { ok: errors.length === 0, errors };
};

export default function EditPriceList() {
    const { list, levels, companies } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const navigate = useNavigate();
    const t = useTranslation();
    const hasNavigated = useRef(false);

    const [form, setForm] = useState<FieldMap>({
        name: "",
        supplier: "",
        columns: "",
        valid_from: "",
        valid_to: "",
    });
    const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
    const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

    useEffect(() => {
        // Parse existing columns from JSON array
        let selectedSet = new Set<string>();
        const raw = list.fields.columns ?? "";
        if (raw && raw.trim()) {
            try {
                const parsed = JSON.parse(raw) as unknown;
                if (Array.isArray(parsed)) {
                    selectedSet = new Set(
                        parsed.filter((item) => typeof item === "string" && item.startsWith("gid://"))
                    );
                }
            } catch (error) {
                console.error("Failed to parse columns JSON", error);
            }
        }

        setSelectedColumns(selectedSet);
        setForm({
            name: list.fields.name || list.displayName,
            supplier: list.fields.supplier ?? "",
            columns: Array.from(selectedSet).join(","),
            valid_from: list.fields.valid_from ?? "",
            valid_to: list.fields.valid_to ?? "",
        });
        hasNavigated.current = false;
    }, [list, levels]);

    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data && !hasNavigated.current) {
            hasNavigated.current = true;
            if (fetcher.data.ok) {
                shopify.toast.show(t("priceLists.toastUpdated"));
                navigate("/app/price-lists");
            } else if (fetcher.data.errors?.length) {
                shopify.toast.show(fetcher.data.errors[0].message, { isError: true });
            }
        }
    }, [fetcher.state, fetcher.data]);

    const setField = (key: string, value: string) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const handleColumnToggle = (levelId: string) => {
        setSelectedColumns((prev) => {
            const updated = new Set(prev);
            if (updated.has(levelId)) {
                updated.delete(levelId);
            } else {
                updated.add(levelId);
            }
            // Update form columns field with updated set
            setForm((prevForm) => ({
                ...prevForm,
                columns: Array.from(updated).join(","),
            }));
            return updated;
        });
    };

    const save = () => {
        const payload: Record<string, string> = { intent: "save" };
        for (const key of Object.keys(form)) {
            if (form[key] !== "") payload[key] = form[key];
        }
        fetcher.submit(payload, { method: "POST" });
    };

    const cancel = () => {
        navigate("/app/price-lists");
    };

    const remove = () => {
        fetcher.submit({ intent: "delete" }, { method: "POST" });
    };

    return (
        <s-page heading={t("priceLists.formEdit")}>
            <s-button
                slot="primary-action"
                variant="primary"
                onClick={cancel}
            >
                {t("action.cancel")}
            </s-button>

            <s-section heading={t("priceLists.formEdit")}>
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
                            {t("action.save")}
                        </s-button>
                        <s-button variant="tertiary" onClick={cancel}>
                            {t("action.cancel")}
                        </s-button>
                        <s-button variant="tertiary" tone="critical" onClick={remove}>
                            {t("action.delete")}
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
