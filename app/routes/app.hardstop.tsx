import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:hardstop_rule";

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
  const t = useTranslation();

  return (
    <s-page heading={t("hardstop.title")}>
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
            </s-table-header-row>
            <s-table-body>
              {rules.map((rule) => (
                <s-table-row key={rule.id}>
                  <s-table-cell>{rule.name}</s-table-cell>
                  <s-table-cell>{rule.condition}</s-table-cell>
                  <s-table-cell>{rule.action}</s-table-cell>
                  <s-table-cell>
                    {rule.exceptionInQuote ? t("common.yes") : t("common.no")}
                  </s-table-cell>
                  <s-table-cell>
                    {rule.active ? t("common.yes") : t("common.no")}
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
