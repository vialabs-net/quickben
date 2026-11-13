import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Table,
  Td,
  Th,
  Tr,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";

import { getDocReader } from "../options";
import { listDocTypes } from "../studio";

import { createTypeAction } from "./actions";
import { AlignedSubmit, Feedback, Field, formatWhen, Heading, linkClass, Notice } from "./shared";
import { StudioPage } from "./studio-page";

import type { PageProps } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

function CreateTypeForm({ action }: Readonly<{ action: (formData: FormData) => Promise<void> }>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader
        title="New document type"
        description="It starts as a draft with one field. Edit it, test it on samples, then publish it."
      />
      <CardBody>
        <form action={action} className="qb:flex qb:flex-wrap qb:items-start qb:gap-4">
          <Field
            label="Key"
            htmlFor="qb-type-key"
            hint="Lowercase words joined by -, e.g. invoice. It cannot change."
          >
            <Input id="qb-type-key" name="key" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" />
          </Field>
          <Field
            label="Name"
            htmlFor="qb-type-label"
            hint="Shown to people, e.g. Supplier invoice."
          >
            <Input id="qb-type-label" name="label" required maxLength={120} />
          </Field>
          <AlignedSubmit>
            <Button type="submit">Create type</Button>
          </AlignedSubmit>
        </form>
      </CardBody>
    </Card>
  );
}

/** Build the Document types page: the list, and the studio of one type at `/<key>`. */
export function createTypesPage(config: QuickbenConfig, key: string) {
  const create = createTypeAction.bind(null, key);

  return async function DocumentTypesPage({
    segments,
    searchParams,
    basePath,
  }: Readonly<PageProps>) {
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const feedback = <Feedback searchParams={searchParams} />;
    const state = getDocReader(qb);
    if (!ctx.user || !state.isStaff(ctx.user)) {
      return (
        <>
          <Heading title="Document types" />
          <Notice>Only platform staff can manage document types.</Notice>
        </>
      );
    }
    const [typeKey] = segments;
    if (typeKey) {
      return (
        <>
          {await StudioPage({ config, adminKey: key, basePath, typeKey, searchParams })}
          {feedback}
        </>
      );
    }
    const types = await listDocTypes(qb, ctx);
    return (
      <>
        <Heading
          title="Document types"
          description="What to read from each kind of document, and how. Versions are drafts until they pass the test bench and are published."
        />
        <Card>
          {types.length === 0 ? (
            <CardBody>
              <p className="qb:text-sm qb:text-zinc-600">
                No document types yet. Create the first one below.
              </p>
            </CardBody>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Published</Th>
                  <Th>Draft</Th>
                  <Th>Samples</Th>
                </tr>
              </thead>
              <tbody>
                {types.map((type) => (
                  <Tr key={type.key}>
                    <Td>
                      <Link
                        href={`${basePath}/document-types/${encodeURIComponent(type.key)}`}
                        className={linkClass}
                      >
                        {type.label}
                      </Link>
                      <p className="qb:text-xs qb:text-zinc-500 qb:font-mono">
                        {type.key}
                        {type.builtin ? " · shipped with the app" : ""}
                      </p>
                    </Td>
                    <Td>
                      {type.published ? (
                        <span className="qb:text-sm">
                          <Badge tone="green">v{type.published.version}</Badge>{" "}
                          <span className="qb:text-zinc-500">
                            {formatWhen(type.published.publishedAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="qb:text-zinc-400">—</span>
                      )}
                    </Td>
                    <Td>
                      {type.draft ? (
                        <Badge tone="amber">v{type.draft.version}</Badge>
                      ) : (
                        <span className="qb:text-zinc-400">—</span>
                      )}
                    </Td>
                    <Td className="qb:tabular-nums">{type.samples}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <CreateTypeForm action={create} />
        {feedback}
      </>
    );
  };
}
