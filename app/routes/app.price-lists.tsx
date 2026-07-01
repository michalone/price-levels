import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useTranslation } from "../i18n/context";

const METAOBJECT_TYPE = "$app:supplier_price_list";

type FieldMap = Record<string, string>;

interface PriceListRow {
  id: string;
  name: string;
  supplier: string;
  columns: string;
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

interface CompaniesResponse {
  data?: {
    companies?: {
      edges: Array<{
        node: {
          id: string;
          name: string;
        };
      }>;
    };
  };
}

function columnsFieldToText(raw: string) {
  if (!raw || !raw.trim()) return "";
  try {
    // Handle both comma-separated and JSON array formats
    if (raw.trim().startsWith("[")) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.length > 0 ? `${parsed.length} price level(s)` : "";
      }
    } else {
      // Comma-separated format
      const items = raw.split(",").filter((item) => item.trim() !== "");
      return items.length > 0 ? `${items.length} price level(s)` : "";
    }
  } catch (error) {
    // Ignore parse errors
  }
  return "";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const [priceListsResponse, companiesResponse] = await Promise.all([
    admin.graphql(
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
    ),
    admin.graphql(
      `#graphql
      query Companies {
        companies(first: 100) {
          edges {
            node {
              id
              name
            }
          }
        }
      }`,
    ),
  ]);

  const priceListsJson = (await priceListsResponse.json()) as PriceListsResponse;
  const edges = priceListsJson.data?.metaobjects?.edges ?? [];

  // Build company ID to name map
  const companiesJson = (await companiesResponse.json()) as CompaniesResponse;
  const companiesEdges = companiesJson.data?.companies?.edges ?? [];
  const companyMap = new Map<string, string>();
  companiesEdges.forEach(({ node }) => {
    companyMap.set(node.id, node.name);
  });

  const priceLists: PriceListRow[] = edges.map(({ node }) => {
    const fields: Record<string, string> = {};
    for (const f of node.fields) fields[f.key] = f.value ?? "";

    // Extract company name from GID
    let supplierName = fields.supplier ?? "";
    if (supplierName.startsWith("gid://")) {
      const companyId = supplierName.split("/").pop();
      if (companyId) {
        supplierName = companyMap.get(`gid://shopify/Company/${companyId}`) || supplierName;
      }
    }

    return {
      id: node.id,
      name: fields.name || node.displayName,
      supplier: supplierName,
      columns: columnsFieldToText(fields.columns ?? ""),
      validFrom: fields.valid_from ?? "",
      validTo: fields.valid_to ?? "",
    };
  });

  return { priceLists };
};

export default function PriceLists() {
  const { priceLists } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const t = useTranslation();

  const handleNew = () => {
    navigate("/app/price-lists/new");
  };

  const handleEdit = (row: PriceListRow) => {
    const listId = row.id.split("/").pop();
    navigate(`/app/price-lists/${listId}`);
  };

  return (
    <s-page heading={t("priceLists.title")}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleNew}
      >
        {t("priceLists.new")}
      </s-button>

      <s-section heading={t("priceLists.listTitle")}>
        <s-paragraph>{t("priceLists.intro")}</s-paragraph>
        {priceLists.length === 0 ? (
          <s-paragraph>{t("priceLists.empty")}</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>{t("field.name")}</s-table-header>
              <s-table-header>{t("field.supplier")}</s-table-header>
              <s-table-header>{t("field.validFrom")}</s-table-header>
              <s-table-header>{t("field.validTo")}</s-table-header>
              <s-table-header>{t("field.actions")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {priceLists.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{row.name}</s-table-cell>
                  <s-table-cell>{row.supplier}</s-table-cell>
                  <s-table-cell>{row.validFrom}</s-table-cell>
                  <s-table-cell>{row.validTo}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      <s-button variant="tertiary" onClick={() => handleEdit(row)}>
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
