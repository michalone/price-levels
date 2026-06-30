import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const METAOBJECT_TYPE = "$app:hardstop_pravidlo";

interface HardstopRow {
  id: string;
  nazev: string;
  podminka: string;
  akce: string;
  vyjimkaVNabidce: boolean;
  aktivni: boolean;
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
    query HardstopPravidla($type: String!) {
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

  const pravidla: HardstopRow[] = edges.map(({ node }) => {
    const fields: Record<string, string> = {};
    for (const f of node.fields) fields[f.key] = f.value ?? "";
    return {
      id: node.id,
      nazev: fields.nazev || node.displayName,
      podminka: fields.podminka ?? "",
      akce: fields.akce ?? "",
      vyjimkaVNabidce: fields.vyjimka_v_nabidce === "true",
      aktivni: fields.aktivni === "true",
    };
  });

  return { pravidla };
};

export default function Hardstop() {
  const { pravidla } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Hardstop pravidla">
      <s-section heading="Seznam pravidel">
        <s-paragraph>
          Pravidla tvrdých limitů cenotvorby (blokace, snížení, skrytí).
          Načítáno z metaobjektů <s-text>app.hardstop_pravidlo</s-text>. Editace
          je zatím ve fázi skeletonu.
        </s-paragraph>
        {pravidla.length === 0 ? (
          <s-paragraph>Zatím nejsou žádná hardstop pravidla.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Název</s-table-header>
              <s-table-header>Podmínka</s-table-header>
              <s-table-header>Akce</s-table-header>
              <s-table-header>Výjimka v nabídce</s-table-header>
              <s-table-header>Aktivní</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {pravidla.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>{p.nazev}</s-table-cell>
                  <s-table-cell>{p.podminka}</s-table-cell>
                  <s-table-cell>{p.akce}</s-table-cell>
                  <s-table-cell>{p.vyjimkaVNabidce ? "Ano" : "Ne"}</s-table-cell>
                  <s-table-cell>{p.aktivni ? "Ano" : "Ne"}</s-table-cell>
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
