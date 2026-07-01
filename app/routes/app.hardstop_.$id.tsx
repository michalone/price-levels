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

const METAOBJECT_TYPE = "$app:hardstop_rule";

type FieldMap = Record<string, string>;

interface HardstopRule {
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

const FIELD_KEYS = ["name", "condition", "action", "exception_in_quote", "active"] as const;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const { id } = params;

    const response = await admin.graphql(
        `#graphql
    query HardstopRule($id: ID!) {
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

    const rule: HardstopRule = {
        id: node.id,
        displayName: node.displayName,
        fields,
    };

    return { rule };
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
    const { admin } = await authenticate.admin(request);
    const { id } = params;
    const formData = await request.formData();
    const intent = String(formData.get("intent") ?? "save");

    if (intent === "delete") {
        const response = await admin.graphql(
            `#graphql
      mutation DeleteHardstop($id: ID!) {
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
            return redirect("/app/hardstop");
        }
        return { ok: false, errors, isDelete: true };
    }

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
    mutation UpdateHardstop($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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

export default function EditHardstopRule() {
    const { rule } = useLoaderData<typeof loader>();
    const fetcher = useFetcher<typeof action>();
    const shopify = useAppBridge();
    const navigate = useNavigate();
    const t = useTranslation();

    const [form, setForm] = useState<FieldMap>({
        name: "",
        condition: "",
        action: "block",
        exception_in_quote: "false",
        active: "true",
    });
    const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

    useEffect(() => {
        setForm({
            name: rule.fields.name || rule.displayName,
            condition: rule.fields.condition ?? "",
            action: rule.fields.action ?? "",
            exception_in_quote: rule.fields.exception_in_quote ?? "false",
            active: rule.fields.active ?? "true",
        });
        hasNavigated.current = false;
    }, [rule]);

    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data && !hasNavigated.current) {
            hasNavigated.current = true;
            if (fetcher.data.ok) {
                shopify.toast.show(t("hardstop.toastUpdated"));
                navigate("/app/hardstop");
            } else if (fetcher.data.errors?.length) {
                shopify.toast.show(fetcher.data.errors[0].message, { isError: true });
            }
        }
    }, [fetcher.state, fetcher.data]);

    const setField = (key: string, value: string) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const save = () => {
        const payload: Record<string, string> = { intent: "save" };
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

    const remove = () => {
        fetcher.submit({ intent: "delete" }, { method: "POST" });
    };

    return (
        <s-page heading={t("hardstop.formEdit")}>
            <s-button
                slot="primary-action"
                variant="primary"
                onClick={cancel}
            >
                {t("action.cancel")}
            </s-button>

            <s-section heading={t("hardstop.formEdit")}>
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
                        {["block", "lower", "hide"].map((o) => (
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
