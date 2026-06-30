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

const METAOBJECT_TYPE = "$app:cenova_hladina";

type FieldMap = Record<string, string>;

interface CenovaHladina {
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
    query CenoveHladiny($type: String!) {
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

  const hladiny: CenovaHladina[] = edges.map(({ node }) => {
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

  return { hladiny };
};

const FIELD_KEYS = [
  "nazev",
  "kod",
  "zaklad",
  "operace",
  "hodnota",
  "zaokrouhleni",
  "poradi",
  "aktivni",
] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");
  const id = formData.get("id") ? String(formData.get("id")) : null;

  if (intent === "delete" && id) {
    const response = await admin.graphql(
      `#graphql
      mutation DeleteCenovaHladina($id: ID!) {
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
    if (key === "aktivni") {
      value = formData.get("aktivni") ? "true" : "false";
    }
    return { key, value };
  }).filter((f) => f.value !== "");

  if (id) {
    const response = await admin.graphql(
      `#graphql
      mutation UpdateCenovaHladina($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
    mutation CreateCenovaHladina($metaobject: MetaobjectCreateInput!) {
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

const ZAKLAD_OPTIONS = [
  { value: "NC", label: "NC (nákupní cena)" },
  { value: "RRP", label: "RRP (doporučená cena)" },
];

const OPERACE_OPTIONS = [
  { value: "plus_pct", label: "+ %" },
  { value: "minus_pct", label: "− %" },
  { value: "plus_eur", label: "+ EUR" },
];

const EMPTY_FORM: FieldMap = {
  id: "",
  nazev: "",
  kod: "",
  zaklad: "NC",
  operace: "plus_pct",
  hodnota: "",
  zaokrouhleni: "",
  poradi: "",
  aktivni: "true",
};

export default function CenoveHladiny() {
  const { hladiny } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [form, setForm] = useState<FieldMap>(EMPTY_FORM);
  const isEditing = form.id !== "";
  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.ok) {
        shopify.toast.show(
          isEditing ? "Cenová hladina upravena" : "Cenová hladina vytvořena",
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
    if (form.aktivni !== "true") delete payload.aktivni;
    fetcher.submit(payload, { method: "POST" });
  };

  const edit = (h: CenovaHladina) => {
    setForm({
      id: h.id,
      nazev: h.fields.nazev ?? "",
      kod: h.fields.kod ?? "",
      zaklad: h.fields.zaklad || "NC",
      operace: h.fields.operace || "plus_pct",
      hodnota: h.fields.hodnota ?? "",
      zaokrouhleni: h.fields.zaokrouhleni ?? "",
      poradi: h.fields.poradi ?? "",
      aktivni: h.fields.aktivni ?? "true",
    });
  };

  const remove = (id: string) => {
    fetcher.submit({ intent: "delete", id }, { method: "POST" });
  };

  return (
    <s-page heading="Cenové hladiny">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => setForm(EMPTY_FORM)}
      >
        Nová hladina
      </s-button>

      <s-section heading={isEditing ? "Upravit hladinu" : "Nová hladina"}>
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Název"
            name="nazev"
            value={form.nazev}
            onChange={(e) =>
              setField("nazev", (e.target as HTMLInputElement).value)
            }
          />
          <s-text-field
            label="Kód"
            name="kod"
            value={form.kod}
            onChange={(e) =>
              setField("kod", (e.target as HTMLInputElement).value)
            }
          />
          <s-select
            label="Základ"
            name="zaklad"
            value={form.zaklad}
            onChange={(e) =>
              setField("zaklad", (e.target as HTMLSelectElement).value)
            }
          >
            {ZAKLAD_OPTIONS.map((o) => (
              <s-option key={o.value} value={o.value}>
                {o.label}
              </s-option>
            ))}
          </s-select>
          <s-select
            label="Operace"
            name="operace"
            value={form.operace}
            onChange={(e) =>
              setField("operace", (e.target as HTMLSelectElement).value)
            }
          >
            {OPERACE_OPTIONS.map((o) => (
              <s-option key={o.value} value={o.value}>
                {o.label}
              </s-option>
            ))}
          </s-select>
          <s-text-field
            label="Hodnota"
            name="hodnota"
            value={form.hodnota}
            onChange={(e) =>
              setField("hodnota", (e.target as HTMLInputElement).value)
            }
          />
          <s-text-field
            label="Zaokrouhlení"
            name="zaokrouhleni"
            value={form.zaokrouhleni}
            onChange={(e) =>
              setField("zaokrouhleni", (e.target as HTMLInputElement).value)
            }
          />
          <s-text-field
            label="Pořadí"
            name="poradi"
            value={form.poradi}
            onChange={(e) =>
              setField("poradi", (e.target as HTMLInputElement).value)
            }
          />
          <s-checkbox
            label="Aktivní"
            name="aktivni"
            checked={form.aktivni === "true"}
            onChange={(e) =>
              setField(
                "aktivni",
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
              {isEditing ? "Uložit změny" : "Vytvořit"}
            </s-button>
            {isEditing && (
              <s-button variant="tertiary" onClick={() => setForm(EMPTY_FORM)}>
                Zrušit
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Seznam cenových hladin">
        {hladiny.length === 0 ? (
          <s-paragraph>Zatím nejsou žádné cenové hladiny.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Název</s-table-header>
              <s-table-header>Kód</s-table-header>
              <s-table-header>Základ</s-table-header>
              <s-table-header>Operace</s-table-header>
              <s-table-header>Hodnota</s-table-header>
              <s-table-header>Aktivní</s-table-header>
              <s-table-header>Akce</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {hladiny.map((h) => (
                <s-table-row key={h.id}>
                  <s-table-cell>{h.fields.nazev || h.displayName}</s-table-cell>
                  <s-table-cell>{h.fields.kod}</s-table-cell>
                  <s-table-cell>{h.fields.zaklad}</s-table-cell>
                  <s-table-cell>{h.fields.operace}</s-table-cell>
                  <s-table-cell>{h.fields.hodnota}</s-table-cell>
                  <s-table-cell>
                    {h.fields.aktivni === "true" ? "Ano" : "Ne"}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      <s-button variant="tertiary" onClick={() => edit(h)}>
                        Upravit
                      </s-button>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => remove(h.id)}
                      >
                        Smazat
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
