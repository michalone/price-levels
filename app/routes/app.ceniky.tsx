import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const METAOBJECT_TYPE = "$app:cenik_dodavatele";

interface CenikRow {
  id: string;
  nazev: string;
  dodavatel: string;
  pocetSloupcu: number;
  platnostOd: string;
  platnostDo: string;
}

interface CenikyResponse {
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
    query CenikyDodavatelu($type: String!) {
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

  const json = (await response.json()) as CenikyResponse;
  const edges = json.data?.metaobjects?.edges ?? [];

  const ceniky: CenikRow[] = edges.map(({ node }) => {
    const fields: Record<string, string> = {};
    for (const f of node.fields) fields[f.key] = f.value ?? "";
    let pocetSloupcu = 0;
    try {
      pocetSloupcu = fields.sloupce
        ? (JSON.parse(fields.sloupce) as string[]).length
        : 0;
    } catch {
      pocetSloupcu = 0;
    }
    return {
      id: node.id,
      nazev: fields.nazev || node.displayName,
      dodavatel: fields.dodavatel ?? "",
      pocetSloupcu,
      platnostOd: fields.platnost_od ?? "",
      platnostDo: fields.platnost_do ?? "",
    };
  });

  return { ceniky };
};

export default function Ceniky() {
  const { ceniky } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Ceníky dodavatelů">
      <s-section heading="Seznam ceníků">
        <s-paragraph>
          Přehled nákupních ceníků dodavatelů. Vytváření a úpravy ceníků jsou
          zatím ve fázi skeletonu – data se načítají z metaobjektů{" "}
          <s-text>app.cenik_dodavatele</s-text>.
        </s-paragraph>
        {ceniky.length === 0 ? (
          <s-paragraph>Zatím nejsou žádné ceníky dodavatelů.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Název</s-table-header>
              <s-table-header>Dodavatel</s-table-header>
              <s-table-header>Počet sloupců</s-table-header>
              <s-table-header>Platnost od</s-table-header>
              <s-table-header>Platnost do</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {ceniky.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>{c.nazev}</s-table-cell>
                  <s-table-cell>{c.dodavatel}</s-table-cell>
                  <s-table-cell>{String(c.pocetSloupcu)}</s-table-cell>
                  <s-table-cell>{c.platnostOd}</s-table-cell>
                  <s-table-cell>{c.platnostDo}</s-table-cell>
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
