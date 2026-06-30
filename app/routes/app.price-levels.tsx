import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:price_level";

type FieldMap = Record<string, string>;

interface PriceLevel {
  id: string;
  handle: string;
  displayName: string;
  fields: FieldMap;
}

interface MetaobjectsQueryResponse {
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

interface MetaobjectMutationResponse {
  data?: {
    result?: {
      metaobject?: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    } | null;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
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
    { variables: { type: METAOBJECT_TYPE } },
  );

  const json = (await response.json()) as MetaobjectsQueryResponse;
  const edges = json.data?.metaobjects?.edges ?? [];

  const levels: PriceLevel[] = edges.map(({ node }) => {
    const fields: FieldMap = {};
    for (const f of node.fields) {
      fields[f.key] = f.value ?? "";
    }
    return {
      id: node.id,
      handle: node.handle,
      displayName: node.displayName,
      fields,
    };
  });

  return { levels };
};

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
  const intent = String(formData.get("intent") ?? "save");
  const id = formData.get("id") ? String(formData.get("id")) : null;

  if (intent === "delete" && id) {
    const response = await admin.graphql(
      `#graphql
      mutation DeletePriceLevel($id: ID!) {
        result: metaobjectDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }`,
      { variables: { id } },
    );
    const json = (await response.json()) as MetaobjectMutationResponse;
    const errors = json.data?.result?.userErrors ?? [];
    return { ok: errors.length === 0, errors };
  }

  // Build the metaobject fields from the submitted form.
  const fields = FIELD_KEYS.map((key) => {
    let value = String(formData.get(key) ?? "");
    if (key === "active") {
      value = formData.get("active") ? "true" : "false";
    }
    return { key, value };
  }).filter((f) => f.value !== "");

  if (id) {
    const response = await admin.graphql(
      `#graphql
      mutation UpdatePriceLevel($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        result: metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
      { variables: { id, metaobject: { fields } } },
    );
    const json = (await response.json()) as MetaobjectMutationResponse;
    const errors = json.data?.result?.userErrors ?? [];
    return { ok: errors.length === 0, errors };
  }

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
const OPERATION_OPTIONS = ["plus_pct", "minus_pct", "plus_eur"] as const;

const EMPTY_FORM: FieldMap = {
  id: "",
  name: "",
  code: "",
  base: "cost",
  operation: "plus_pct",
  value: "",
  rounding: "",
  position: "",
  active: "true",
};

export default function PriceLevels() {
  const { levels } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const t = useTranslation();

  const [form, setForm] = useState<FieldMap>(EMPTY_FORM);
  const isEditing = form.id !== "";
  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        shopify.toast.show(
          isEditing
            ? t("priceLevels.toastUpdated")
            : t("priceLevels.toastCreated"),
        );
        setForm(EMPTY_FORM);
      } else if (fetcher.data.errors?.length) {
        shopify.toast.show(fetcher.data.errors[0].message, { isError: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

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

  const edit = (level: PriceLevel) => {
    setForm({
      id: level.id,
      name: level.fields.name ?? "",
      code: level.fields.code ?? "",
      base: level.fields.base || "cost",
      operation: level.fields.operation || "plus_pct",
      value: level.fields.value ?? "",
      rounding: level.fields.rounding ?? "",
      position: level.fields.position ?? "",
      active: level.fields.active ?? "true",
    });
  };

  const remove = (id: string) => {
    fetcher.submit({ intent: "delete", id }, { method: "POST" });
  };

  return (
    <s-page heading={t("priceLevels.title")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => setForm(EMPTY_FORM)}
      >
        {t("priceLevels.new")}
      </s-button>

      <s-section
        heading={
          isEditing ? t("priceLevels.formEdit") : t("priceLevels.formNew")
        }
      >
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
              {isEditing ? t("action.save") : t("action.create")}
            </s-button>
            {isEditing && (
              <s-button variant="tertiary" onClick={() => setForm(EMPTY_FORM)}>
                {t("action.cancel")}
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading={t("priceLevels.listTitle")}>
        {levels.length === 0 ? (
          <s-paragraph>{t("priceLevels.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("field.name")}</s-table-header>
              <s-table-header>{t("field.code")}</s-table-header>
              <s-table-header>{t("field.base")}</s-table-header>
              <s-table-header>{t("field.operation")}</s-table-header>
              <s-table-header>{t("field.value")}</s-table-header>
              <s-table-header>{t("field.active")}</s-table-header>
              <s-table-header>{t("field.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {levels.map((level) => (
                <s-table-row key={level.id}>
                  <s-table-cell>
                    {level.fields.name || level.displayName}
                  </s-table-cell>
                  <s-table-cell>{level.fields.code}</s-table-cell>
                  <s-table-cell>{level.fields.base}</s-table-cell>
                  <s-table-cell>{level.fields.operation}</s-table-cell>
                  <s-table-cell>{level.fields.value}</s-table-cell>
                  <s-table-cell>
                    {level.fields.active === "true"
                      ? t("common.yes")
                      : t("common.no")}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      <s-button variant="tertiary" onClick={() => edit(level)}>
                        {t("action.edit")}
                      </s-button>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => remove(level.id)}
                      >
                        {t("action.delete")}
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
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
