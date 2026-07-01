import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:hardstop_rule";

type FieldMap = Record<string, string>;

interface BadgeStyle {
  label: string;
  tone?: "success" | "critical" | "warning" | "info";
}

interface HardstopRow {
  id: string;
  name: string;
  condition: string;
  action: string;
  exceptionInQuote: boolean;
  active: boolean;
}

interface HardstopResponse {
  data?: {
    metaobjects?: {
      edges: Array<{
        node: {
          id: string;
          displayName: string;
          fields: Array<{ key: string; value: string | null }>;
        };
      }>;
    };
  };
}

const ACTION_COLORS: Record<string, BadgeStyle> = {
  block: { label: "Blokovat", tone: "critical" },
  lower: { label: "Snížit", tone: "warning" },
  hide: { label: "Skrýt", tone: "info" },
};

const ACTIVE_COLORS: Record<string, BadgeStyle> = {
  "true": { label: "Aktivní", tone: "success" },
  "false": { label: "Neaktivní", tone: "warning" },
};

function Badge({ label, tone }: BadgeStyle) {
  return <s-badge tone={tone}>{label}</s-badge>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query HardstopRules($type: String!) {
      metaobjects(type: $type, first: 100) {
        edges {
          node {
            id
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

  const json = (await response.json()) as HardstopResponse;
  const edges = json.data?.metaobjects?.edges ?? [];

  const rules: HardstopRow[] = edges.map(({ node }) => {
    const fields: Record<string, string> = {};
    for (const f of node.fields) fields[f.key] = f.value ?? "";
    return {
      id: node.id,
      name: fields.name || node.displayName,
      condition: fields.condition ?? "",
      action: fields.action ?? "",
      exceptionInQuote: fields.exception_in_quote === "true",
      active: fields.active === "true",
    };
  });

  return { rules };
};

export default function Hardstop() {
  const { rules } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const t = useTranslation();

  const handleNew = () => {
    navigate("/app/hardstop/new");
  };

  const handleEdit = (rule: HardstopRow) => {
    const ruleId = rule.id.split("/").pop();
    navigate(`/app/hardstop/${ruleId}`);
  };

  return (
    <s-page heading={t("hardstop.title")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleNew}
      >
        {t("hardstop.new")}
      </s-button>

      <s-section heading={t("hardstop.listTitle")}>
        <s-paragraph>{t("hardstop.intro")}</s-paragraph>
        {rules.length === 0 ? (
          <s-paragraph>{t("hardstop.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("field.name")}</s-table-header>
              <s-table-header>{t("field.condition")}</s-table-header>
              <s-table-header>{t("field.action")}</s-table-header>
              <s-table-header>{t("field.exceptionInQuote")}</s-table-header>
              <s-table-header>{t("field.active")}</s-table-header>
              <s-table-header>{t("field.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((rule) => (
                <s-table-row key={rule.id}>
                  <s-table-cell>{rule.name}</s-table-cell>
                  <s-table-cell>{rule.condition}</s-table-cell>
                  <s-table-cell>
                    {ACTION_COLORS[rule.action] ? (
                      <Badge {...ACTION_COLORS[rule.action]} />
                    ) : (
                      rule.action
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {rule.exceptionInQuote ? t("common.yes") : t("common.no")}
                  </s-table-cell>
                  <s-table-cell>
                    {ACTIVE_COLORS[rule.active ? "true" : "false"] && (
                      <Badge {...ACTIVE_COLORS[rule.active ? "true" : "false"]} />
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      <s-button variant="tertiary" onClick={() => handleEdit(rule)}>
                        {t("action.edit")}
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
