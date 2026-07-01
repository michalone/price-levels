import { useEffect, useRef, useState } from "react";
import type {
    ActionFunctionArgs,
    HeadersFunction,
} from "react-router";
import { useNavigate } from "react-router";
import { useFetcher, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:price_level";

type FieldMap = Record<string, string>;

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

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const fields = FIELD_KEYS.map((key) => {
        let value = String(formData.get(key) ?? "");
        if (key === "active") {
            value = formData.get("active") ? "true" : "false";
        }
        return { key, value };
    }).filter((f) => f.value !== "");

    const response = await admin.graphql(
        `#graphql
    mutation CreatePriceLevel($metaobject: MetaobjectCreateInput!) {
      result: metaobjectCreate(metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`,
        {
            variables: {
                metaobject: { type: METAOBJECT_TYPE, fields },
            },
        },
    );
    const json = (await response.json()) as MetaobjectMutationResponse;
    const errors = json.data?.result?.userErrors ?? [];
    return { ok: errors.length === 0, errors };
};

const BASE_OPTIONS = ["cost", "rrp"] as const;
const OPERATION_OPTIONS = ["plus_pct", "minus_pct", "plus_eur", "equal_to"] as const;

const EMPTY_FORM: FieldMap = {
    name: "",
    code: "",
    base: "cost",
    operation: "plus_pct",
    value: "",
    rounding: "",
    position: "",
    active: "true",
};

export default function NewPriceLevel() {
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const navigate = useNavigate();
    const t = useTranslation();

    const [form, setForm] = useState<FieldMap>(EMPTY_FORM);
    const hasNavigated = useRef(false);
    const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data && !hasNavigated.current) {
            if (fetcher.data.ok) {
                hasNavigated.current = true;
                shopify.toast.show(t("priceLevels.toastCreated"));
                navigate("/app/price-levels");
            } else if (fetcher.data.errors?.length) {
                shopify.toast.show(fetcher.data.errors[0].message, { isError: true });
            }
        }
    }, [fetcher.state, fetcher.data]);

    const setField = (key: string, value: string) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const save = () => {
        const payload: Record<string, string> = {};
        for (const key of Object.keys(form)) {
            if (form[key] !== "") payload[key] = form[key];
        }
        if (form.active !== "true") delete payload.active;
        fetcher.submit(payload, { method: "POST" });
    };

    const cancel = () => {
        navigate("/app/price-levels");
    };

    return (
        <s-page heading={t("priceLevels.formNew")}>
            <s-button
                slot="primary-action"
                variant="primary"
                onClick={cancel}
            >
                {t("action.cancel")}
            </s-button>

            <s-section heading={t("priceLevels.formNew")}>
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
                    <s-text-field
                        label={t("field.value")}
                        name="value"
                        value={form.value}
                        onChange={(e) =>
                            setField("value", (e.target as HTMLInputElement).value)
                        }
                    />
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
