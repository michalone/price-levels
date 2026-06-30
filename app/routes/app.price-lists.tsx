import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:supplier_price_list";

interface PriceListRow {
  id: string;
  name: string;
  supplier: string;
  columnsCount: number;
  validFrom: string;
  validTo: string;
}

interface PriceListsResponse {
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
    query SupplierPriceLists($type: String!) {
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

  const json = (await response.json()) as PriceListsResponse;
  const edges = json.data?.metaobjects?.edges ?? [];

  const priceLists: PriceListRow[] = edges.map(({ node }) => {
    const fields: Record<string, string> = {};
    for (const f of node.fields) fields[f.key] = f.value ?? "";
    let columnsCount = 0;
    try {
      columnsCount = fields.columns
        ? (JSON.parse(fields.columns) as string[]).length
        : 0;
    } catch {
      columnsCount = 0;
    }
    return {
      id: node.id,
      name: fields.name || node.displayName,
      supplier: fields.supplier ?? "",
      columnsCount,
      validFrom: fields.valid_from ?? "",
      validTo: fields.valid_to ?? "",
    };
  });

  return { priceLists };
};

export default function PriceLists() {
  const { priceLists } = useLoaderData<typeof loader>();
  const t = useTranslation();

  return (
    <s-page heading={t("priceLists.title")}>
      <s-section heading={t("priceLists.listTitle")}>
        <s-paragraph>{t("priceLists.intro")}</s-paragraph>
        {priceLists.length === 0 ? (
          <s-paragraph>{t("priceLists.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("field.name")}</s-table-header>
              <s-table-header>{t("field.supplier")}</s-table-header>
              <s-table-header>{t("field.columnsCount")}</s-table-header>
              <s-table-header>{t("field.validFrom")}</s-table-header>
              <s-table-header>{t("field.validTo")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {priceLists.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{row.name}</s-table-cell>
                  <s-table-cell>{row.supplier}</s-table-cell>
                  <s-table-cell>{String(row.columnsCount)}</s-table-cell>
                  <s-table-cell>{row.validFrom}</s-table-cell>
                  <s-table-cell>{row.validTo}</s-table-cell>
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
