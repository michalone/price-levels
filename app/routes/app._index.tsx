import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const PRICE_LEVEL_TYPE = "$app:price_level";
const PRICE_LIST_TYPE = "$app:supplier_price_list";
const HARDSTOP_TYPE = "$app:hardstop_rule";

interface MetaobjectNode {
  id: string;
  displayName: string;
  fields: Array<{ key: string; value: string | null }>;
}

interface MetaobjectConnection {
  edges: Array<{ node: MetaobjectNode }>;
}

interface OverviewResponse {
  data?: {
    priceLevels?: MetaobjectConnection;
    priceLists?: MetaobjectConnection;
    hardstops?: MetaobjectConnection;
  };
}

interface PriceLevelOverviewRow {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

interface PriceListOverviewRow {
  id: string;
  name: string;
  supplier: string;
  validFrom: string;
  validTo: string;
}

interface HardstopOverviewRow {
  id: string;
  name: string;
  condition: string;
  action: string;
  active: boolean;
}

function toFieldsMap(fields: Array<{ key: string; value: string | null }>) {
  const mapped: Record<string, string> = {};
  for (const field of fields) {
    mapped[field.key] = field.value ?? "";
  }
  return mapped;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
    query PriceOverview(
      $priceLevelType: String!
      $priceListType: String!
      $hardstopType: String!
    ) {
      priceLevels: metaobjects(type: $priceLevelType, first: 100) {
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
      priceLists: metaobjects(type: $priceListType, first: 100) {
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
      hardstops: metaobjects(type: $hardstopType, first: 100) {
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
    {
      variables: {
        priceLevelType: PRICE_LEVEL_TYPE,
        priceListType: PRICE_LIST_TYPE,
        hardstopType: HARDSTOP_TYPE,
      },
    },
  );

  const json = (await response.json()) as OverviewResponse;

  const priceLevels: PriceLevelOverviewRow[] =
    json.data?.priceLevels?.edges.map(({ node }) => {
      const fields = toFieldsMap(node.fields);
      return {
        id: node.id,
        name: fields.name || node.displayName,
        code: fields.code ?? "",
        active: fields.active === "true",
      };
    }) ?? [];

  const priceLists: PriceListOverviewRow[] =
    json.data?.priceLists?.edges.map(({ node }) => {
      const fields = toFieldsMap(node.fields);
      return {
        id: node.id,
        name: fields.name || node.displayName,
        supplier: fields.supplier ?? "",
        validFrom: fields.valid_from ?? "",
        validTo: fields.valid_to ?? "",
      };
    }) ?? [];

  const hardstops: HardstopOverviewRow[] =
    json.data?.hardstops?.edges.map(({ node }) => {
      const fields = toFieldsMap(node.fields);
      return {
        id: node.id,
        name: fields.name || node.displayName,
        condition: fields.condition ?? "",
        action: fields.action ?? "",
        active: fields.active === "true",
      };
    }) ?? [];

  return { priceLevels, priceLists, hardstops };
};

export default function Index() {
  const { priceLevels, priceLists, hardstops } = useLoaderData<typeof loader>();
  const t = useTranslation();

  return (
    <s-page heading={t("home.title")}>
      <s-section heading={t("home.priceLevelsTitle")}>
        <s-paragraph>{t("home.priceLevelsIntro")}</s-paragraph>
        {priceLevels.length === 0 ? (
          <s-paragraph>{t("priceLevels.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("field.name")}</s-table-header>
              <s-table-header>{t("field.code")}</s-table-header>
              <s-table-header>{t("field.active")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {priceLevels.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <s-link href={`/app/price-levels?edit=${encodeURIComponent(row.id)}`}>
                      {row.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{row.code}</s-table-cell>
                  <s-table-cell>
                    {row.active ? t("common.yes") : t("common.no")}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("home.priceListsTitle")}>
        <s-paragraph>{t("home.priceListsIntro")}</s-paragraph>
        {priceLists.length === 0 ? (
          <s-paragraph>{t("priceLists.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("field.name")}</s-table-header>
              <s-table-header>{t("field.supplier")}</s-table-header>
              <s-table-header>{t("field.validFrom")}</s-table-header>
              <s-table-header>{t("field.validTo")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {priceLists.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <s-link href={`/app/price-lists?edit=${encodeURIComponent(row.id)}`}>
                      {row.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{row.supplier}</s-table-cell>
                  <s-table-cell>{row.validFrom}</s-table-cell>
                  <s-table-cell>{row.validTo}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={t("home.hardstopsTitle")}>
        <s-paragraph>{t("home.hardstopsIntro")}</s-paragraph>
        {hardstops.length === 0 ? (
          <s-paragraph>{t("hardstop.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("field.name")}</s-table-header>
              <s-table-header>{t("field.condition")}</s-table-header>
              <s-table-header>{t("field.action")}</s-table-header>
              <s-table-header>{t("field.active")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {hardstops.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <s-link href={`/app/hardstop?edit=${encodeURIComponent(row.id)}`}>
                      {row.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{row.condition}</s-table-cell>
                  <s-table-cell>{row.action}</s-table-cell>
                  <s-table-cell>
                    {row.active ? t("common.yes") : t("common.no")}
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
