import { type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
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

const BASE_OPTIONS = { cost: "cost", rrp: "rrp" } as const;
const OPERATION_OPTIONS = { plus_pct: "plus_pct", minus_pct: "minus_pct", plus_eur: "plus_eur", equal_to: "equal_to" } as const;
const ACTIVE_OPTIONS = { "true": "true", "false": "false" } as const;

interface BadgeStyle {
  label: string;
  tone?: "success" | "critical" | "warning" | "info";
}

const BASE_COLORS: Record<string, BadgeStyle> = {
  cost: { label: "Nákupní cena", tone: "info" },
  rrp: { label: "RRP", tone: "info" },
};

const OPERATION_COLORS: Record<string, BadgeStyle> = {
  plus_pct: { label: "+ %", tone: "info" },
  minus_pct: { label: "− %", tone: "critical" },
  plus_eur: { label: "+ EUR", tone: "info" },
  equal_to: { label: "=", tone: "info" },
};

const ACTIVE_COLORS: Record<string, BadgeStyle> = {
  "true": { label: "Aktivní", tone: "success" },
  "false": { label: "Neaktivní", tone: "warning" },
};

function Badge({ label, tone }: BadgeStyle) {
  return <s-badge tone={tone}>{label}</s-badge>;
}

export default function PriceLevels() {
  const { levels } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const t = useTranslation();

  const handleNew = () => {
    navigate("/app/price-levels/new");
  };

  const handleEdit = (level: PriceLevel) => {
    const levelId = level.id.split("/").pop();
    navigate(`/app/price-levels/${levelId}`);
  };

  return (
    <s-page heading={t("priceLevels.title")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleNew}
      >
        {t("priceLevels.new")}
      </s-button>

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
              {levels.map((level) => {
                const baseValue = level.fields.base || "cost";
                const operationValue = level.fields.operation || "plus_pct";
                const activeValue = level.fields.active || "true";

                return (
                  <s-table-row key={level.id}>
                    <s-table-cell>
                      {level.fields.name || level.displayName}
                    </s-table-cell>
                    <s-table-cell>{level.fields.code}</s-table-cell>
                    <s-table-cell>
                      {BASE_COLORS[baseValue] && (
                        <Badge {...BASE_COLORS[baseValue]} />
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {OPERATION_COLORS[operationValue] && (
                        <Badge {...OPERATION_COLORS[operationValue]} />
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {operationValue !== "equal_to" ? level.fields.value : ""}
                    </s-table-cell>
                    <s-table-cell>
                      {ACTIVE_COLORS[activeValue] && (
                        <Badge {...ACTIVE_COLORS[activeValue]} />
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-300">
                        <s-button
                          variant="tertiary"
                          onClick={() => handleEdit(level)}
                        >
                          {t("action.edit")}
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
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
