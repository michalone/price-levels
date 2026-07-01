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

const METAOBJECT_TYPE = "$app:hardstop_rule";

type FieldMap = Record<string, string>;

interface MetaobjectMutationResponse {
    data?: {
        result?: {
            metaobject?: { id: string } | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
        } | null;
    };
}

const FIELD_KEYS = ["name", "condition", "action", "exception_in_quote", "active"] as const;
const ACTION_OPTIONS = ["block", "lower", "hide"] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();

    const fields = FIELD_KEYS.map((key) => {
        if (key === "exception_in_quote" || key === "active") {
            return {
                key,
                value: formData.get(key) ? "true" : "false",
            };
        }
        return { key, value: String(formData.get(key) ?? "") };
    }).filter((field) => field.value !== "");

    const response = await admin.graphql(
        `#graphql
    mutation CreateHardstop($metaobject: MetaobjectCreateInput!) {
      result: metaobjectCreate(metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`,
        { variables: { metaobject: { type: METAOBJECT_TYPE, fields } } },
    );
    const json = (await response.json()) as MetaobjectMutationResponse;
    const errors = json.data?.result?.userErrors ?? [];
    return { ok: errors.length === 0, errors };
};

const EMPTY_FORM: FieldMap = {
    name: "",
    condition: "",
    action: "block",
    exception_in_quote: "false",
    active: "true",
};

export default function NewHardstopRule() {
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
                shopify.toast.show(t("hardstop.toastCreated"));
                navigate("/app/hardstop");
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
        if (form.exception_in_quote !== "true") delete payload.exception_in_quote;
        if (form.active !== "true") delete payload.active;
        fetcher.submit(payload, { method: "POST" });
    };

    const cancel = () => {
        navigate("/app/hardstop");
    };

    return (
        <s-page heading={t("hardstop.formNew")}>
            <s-button
                slot="primary-action"
                variant="primary"
                onClick={cancel}
            >
                {t("action.cancel")}
            </s-button>

            <s-section heading={t("hardstop.formNew")}>
                <s-stack direction="block" gap="base">
                    <s-text-field
                        label={t("field.name")}
                        name="name"
                        value={form.name}
                        onChange={(e) => setField("name", (e.target as HTMLInputElement).value)}
                    />
                    <s-text-field
                        label={t("field.condition")}
                        name="condition"
                        value={form.condition}
                        onChange={(e) =>
                            setField("condition", (e.target as HTMLInputElement).value)
                        }
                    />
                    <s-select
                        label={t("field.action")}
                        name="action"
                        value={form.action}
                        onChange={(e) => setField("action", (e.target as HTMLSelectElement).value)}
                    >
                        {ACTION_OPTIONS.map((o) => (
                            <s-option key={o} value={o}>
                                {t(`action.${o}`)}
                            </s-option>
                        ))}
                    </s-select>
                    <s-checkbox
                        label={t("field.exceptionInQuote")}
                        name="exception_in_quote"
                        checked={form.exception_in_quote === "true"}
                        onChange={(e) =>
                            setField(
                                "exception_in_quote",
                                (e.target as HTMLInputElement).checked ? "true" : "false",
                            )
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
