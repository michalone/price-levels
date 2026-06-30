import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Button,
  Banner,
  ProgressIndicator,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useState } from "react";

const TARGET = "admin.customer-details.block.render";

export default reactExtension(TARGET, () => <App />);

interface Hladina {
  id: string;
  label: string;
}

interface LoadResult {
  customer: {
    companyContactProfiles: Array<{
      company: {
        id: string;
        name: string;
        vychozi: { value: string } | null;
      };
    }>;
  } | null;
  metaobjects: {
    edges: Array<{ node: { id: string; displayName: string } }>;
  };
}

interface SaveResult {
  metafieldsSet: {
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

function App() {
  const { data, query } = useApi(TARGET);
  const customerId = data.selected[0]?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [hladiny, setHladiny] = useState<Hladina[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await query<LoadResult>(
        `query GetData($id: ID!) {
          customer(id: $id) {
            companyContactProfiles {
              company {
                id
                name
                vychozi: metafield(namespace: "$app", key: "vychozi_hladina") {
                  value
                }
              }
            }
          }
          metaobjects(type: "$app:cenova_hladina", first: 100) {
            edges {
              node {
                id
                displayName
              }
            }
          }
        }`,
        { variables: { id: customerId } },
      );

      const levels =
        res?.data?.metaobjects?.edges?.map((e) => ({
          id: e.node.id,
          label: e.node.displayName,
        })) ?? [];
      setHladiny(levels);

      const company =
        res?.data?.customer?.companyContactProfiles?.[0]?.company ?? null;
      if (company) {
        setCompanyId(company.id);
        setCompanyName(company.name);
        setSelected(company.vychozi?.value ?? "");
      }
    } catch (e) {
      setMessage("Nepodařilo se načíst data.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!companyId) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await query<SaveResult>(
        `mutation SetHladina($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                ownerId: companyId,
                namespace: "$app",
                key: "vychozi_hladina",
                type: "metaobject_reference",
                value: selected,
              },
            ],
          },
        },
      );
      const errs = res?.data?.metafieldsSet?.userErrors ?? [];
      setMessage(errs.length ? errs[0].message : "Uloženo.");
    } catch (e) {
      setMessage("Uložení selhalo.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminBlock title="Cenová hladina (B2B)">
        <InlineStack inlineAlignment="center">
          <ProgressIndicator size="small-200" />
        </InlineStack>
      </AdminBlock>
    );
  }

  return (
    <AdminBlock title="Cenová hladina (B2B)">
      <BlockStack gap="base">
        {!companyId ? (
          <Banner tone="info">
            Tento zákazník není přiřazen k žádné společnosti (Company).
          </Banner>
        ) : (
          <BlockStack gap="base">
            <Text>Společnost: {companyName}</Text>
            <Select
              label="Výchozí cenová hladina"
              value={selected}
              onChange={(value: string) => setSelected(value)}
              options={[
                { value: "", label: "— žádná —" },
                ...hladiny.map((h) => ({ value: h.id, label: h.label })),
              ]}
            />
            <Button variant="primary" disabled={saving} onClick={save}>
              Uložit
            </Button>
          </BlockStack>
        )}
        {message ? <Text>{message}</Text> : null}
      </BlockStack>
    </AdminBlock>
  );
}
