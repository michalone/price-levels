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

const METAOBJECT_TYPE = "$app:price_level";

type FieldMap = Record<string, string>;

interface PriceLevel {
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

interface MetaobjectMutationResponse {
    data?: {
        result?: {
            metaobject?: { id: string } | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
        } | null;
    };
}

const FIELD_KEYS = [
    "name",
    "code",
    "base",
    "operation",
    "value",
    "rounding",
    "position",
    "active",
] as const;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const { id } = params;

    const response = await admin.graphql(
        `#graphql
    query PriceLevel($id: ID!) {
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
    );

    const json = (await response.json()) as MetaobjectsQueryResponse;
    const node = json.data?.metaobject;

    if (!node) {
        throw new Response("Not found", { status: 404 });
    }

    const fields: FieldMap = {};
    for (const f of node.fields) {
        fields[f.key] = f.value ?? "";
    }

    const level: PriceLevel = {
        id: node.id,
        displayName: node.displayName,
        fields,
    };

    return { level };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const { id } = params;
    const formData = await request.formData();
    const intent = String(formData.get("intent") ?? "save");

    if (intent === "delete") {
        const response = await admin.graphql(
            `#graphql
      mutation DeletePriceLevel($id: ID!) {
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
            return redirect("/app/price-levels");
        }
        return { ok: false, errors, isDelete: true };
    }

    const fields = FIELD_KEYS.map((key) => {
        let value = String(formData.get(key) ?? "");
        if (key === "active") {
            value = formData.get("active") ? "true" : "false";
        }
        return { key, value };
    }).filter((f) => f.value !== "");

    const response = await admin.graphql(
        `#graphql
    mutation UpdatePriceLevel($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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

const BASE_OPTIONS = ["cost", "rrp"] as const;
const OPERATION_OPTIONS = ["plus_pct", "minus_pct", "plus_eur", "equal_to"] as const;

export default function EditPriceLevel() {
    const { level } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const navigate = useNavigate();
    const t = useTranslation();

    const [form, setForm] = useState<FieldMap>({
        name: "",
        code: "",
        base: "cost",
        operation: "plus_pct",
        value: "",
        rounding: "",
        position: "",
        active: "true",
    });
    const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

    useEffect(() => {
        setForm({
            name: level.fields.name ?? "",
            code: level.fields.code ?? "",
            base: level.fields.base || "cost",
            operation: level.fields.operation || "plus_pct",
            value: level.fields.value ?? "",
            rounding: level.fields.rounding ?? "",
            position: level.fields.position ?? "",
            active: level.fields.active ?? "true",
        });
    }, [level]);

    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data) {
            if (fetcher.data.ok) {
                shopify.toast.show(t("priceLevels.toastUpdated"));
                navigate("/app/price-levels");
            } else if (fetcher.data.errors?.length) {
                shopify.toast.show(fetcher.data.errors[0].message, { isError: true });
            }
        }
    }, [fetcher.state, fetcher.data, navigate, shopify, t]);

    const setField = (key: string, value: string) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const save = () => {
        const payload: Record<string, string> = { intent: "save" };
        for (const key of Object.keys(form)) {
            if (form[key] !== "") payload[key] = form[key];
        }
        if (form.active !== "true") delete payload.active;
        fetcher.submit(payload, { method: "POST" });
    };

    const cancel = () => {
        navigate("/app/price-levels");
    };

    const remove = () => {
        fetcher.submit({ intent: "delete" }, { method: "POST" });
    };

    return (
        <s-page heading={t("priceLevels.formEdit")}>
            <s-button
                slot="primary-action"
                variant="primary"
                onClick={cancel}
            >
                {t("action.cancel")}
            </s-button>

            <s-section heading={t("priceLevels.formEdit")}>
                <s-stack direction="block" gap="base">
                    <s-text-field
                        label={t("field.name")}
                        name="name"
                        value={form.name}
                        onChange={(e) =>
                            setField("name", (e.target as HTMLInputElement).value)
                        }
                    />
                    <s-text-field
                        label={t("field.code")}
                        name="code"
                        value={form.code}
                        onChange={(e) =>
                            setField("code", (e.target as HTMLInputElement).value)
                        }
                    />
                    <s-select
                        label={t("field.base")}
                        name="base"
                        value={form.base}
                        onChange={(e) =>
                            setField("base", (e.target as HTMLSelectElement).value)
                        }
                    >
                        {BASE_OPTIONS.map((o) => (
                            <s-option key={o} value={o}>
                                {t(`base.${o}`)}
                            </s-option>
                        ))}
                    </s-select>
                    <s-select
                        label={t("field.operation")}
                        name="operation"
                        value={form.operation}
                        onChange={(e) =>
                            setField("operation", (e.target as HTMLSelectElement).value)
                        }
                    >
                        {OPERATION_OPTIONS.map((o) => (
                            <s-option key={o} value={o}>
                                {t(`operation.${o}`)}
                            </s-option>
                        ))}
                    </s-select>
                    {form.operation !== "equal_to" && (
                        <s-text-field
                            label={t("field.value")}
                            name="value"
                            value={form.value}
                            onChange={(e) =>
                                setField("value", (e.target as HTMLInputElement).value)
                            }
                        />
                    )}
                    <s-text-field
                        label={t("field.rounding")}
                        name="rounding"
                        value={form.rounding}
                        onChange={(e) =>
                            setField("rounding", (e.target as HTMLInputElement).value)
                        }
                    />
                    <s-text-field
                        label={t("field.position")}
                        name="position"
                        value={form.position}
                        onChange={(e) =>
                            setField("position", (e.target as HTMLInputElement).value)
                        }
                    />
                    <s-checkbox
                        label={t("field.active")}
                        name="active"
                        checked={form.active === "true"}
                        onChange={(e) =>
                            setField(
                                "active",
                                (e.target as HTMLInputElement).checked ? "true" : "false",
                            )
                        }
                    />

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
