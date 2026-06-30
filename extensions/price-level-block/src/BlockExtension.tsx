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

// App-owned Company metafield declared in shopify.app.toml as
// [company.metafields.pricing.default_level] -> reserved namespace "$app:pricing".
const METAFIELD_NAMESPACE = "$app:pricing";
const METAFIELD_KEY = "default_level";

export default reactExtension(TARGET, () => <App />);

interface Level {
  id: string;
  label: string;
}

interface LoadResult {
  customer: {
    companyContactProfiles: Array<{
      company: {
        id: string;
        name: string;
        defaultLevel: { value: string } | null;
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
  const { data, query, i18n } = useApi(TARGET);
  const customerId = data.selected[0]?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [levels, setLevels] = useState<Level[]>([]);
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
                defaultLevel: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
                  value
                }
              }
            }
          }
          metaobjects(type: "$app:price_level", first: 100) {
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

      const loadedLevels =
        res?.data?.metaobjects?.edges?.map((e) => ({
          id: e.node.id,
          label: e.node.displayName,
        })) ?? [];
      setLevels(loadedLevels);

      const company =
        res?.data?.customer?.companyContactProfiles?.[0]?.company ?? null;
      if (company) {
        setCompanyId(company.id);
        setCompanyName(company.name);
        setSelected(company.defaultLevel?.value ?? "");
      }
    } catch (e) {
      setMessage(i18n.translate("loadError"));
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
        `mutation SetDefaultLevel($metafields: [MetafieldsSetInput!]!) {
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
                namespace: METAFIELD_NAMESPACE,
                key: METAFIELD_KEY,
                type: "metaobject_reference",
                value: selected,
              },
            ],
          },
        },
      );
      const errs = res?.data?.metafieldsSet?.userErrors ?? [];
      setMessage(errs.length ? errs[0].message : i18n.translate("saved"));
    } catch (e) {
      setMessage(i18n.translate("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminBlock title={i18n.translate("title")}>
        <InlineStack inlineAlignment="center">
          <ProgressIndicator size="small-200" />
        </InlineStack>
      </AdminBlock>
    );
  }

  return (
    <AdminBlock title={i18n.translate("title")}>
      <BlockStack gap="base">
        {!companyId ? (
          <Banner tone="info">{i18n.translate("noCompany")}</Banner>
        ) : (
          <BlockStack gap="base">
            <Text>{i18n.translate("company", { name: companyName })}</Text>
            <Select
              label={i18n.translate("defaultLevel")}
              value={selected}
              onChange={(value: string) => setSelected(value)}
              options={[
                { value: "", label: i18n.translate("none") },
                ...levels.map((l) => ({ value: l.id, label: l.label })),
              ]}
            />
            <Button variant="primary" disabled={saving} onClick={save}>
              {i18n.translate("save")}
            </Button>
          </BlockStack>
        )}
        {message ? <Text>{message}</Text> : null}
      </BlockStack>
    </AdminBlock>
  );
}
