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
import { docReaderT } from "./messages";
import { SamplePage } from "./sample-page";
import {
  AlignedSubmit,
  EMPTY,
  Feedback,
  Field,
  formatWhen,
  Heading,
  linkClass,
  Notice,
} from "./shared";
import { StudioPage } from "./studio-page";

import type { DocReaderT } from "./messages";
import type { PageProps } from "@quickben/admin";
import type { QuickbenConfig } from "@quickben/core";

function CreateTypeForm({
  action,
  t,
}: Readonly<{ action: (formData: FormData) => Promise<void>; t: DocReaderT }>) {
  return (
    <Card className="qb:mt-5">
      <CardHeader title={t("create.title")} description={t("create.description")} />
      <CardBody>
        <form action={action} className="qb:flex qb:flex-wrap qb:items-start qb:gap-4">
          <Field label={t("create.key")} htmlFor="qb-type-key" hint={t("create.keyHint")}>
            <Input id="qb-type-key" name="key" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" />
          </Field>
          <Field label={t("create.name")} htmlFor="qb-type-label" hint={t("create.nameHint")}>
            <Input id="qb-type-label" name="label" required maxLength={120} />
          </Field>
          <AlignedSubmit>
            <Button type="submit">{t("create.submit")}</Button>
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
    i18n,
  }: Readonly<PageProps>) {
    const t = docReaderT(i18n);
    const qb = await getQuickben(config);
    const ctx = await getRequestContext(config);
    const feedback = <Feedback searchParams={searchParams} i18n={i18n} />;
    const state = getDocReader(qb);
    if (!ctx.user || !state.isStaff(ctx.user)) {
      return (
        <>
          <Heading title={t("types.title")} />
          <Notice>{t("types.staffOnly")}</Notice>
        </>
      );
    }
    const [typeKey, section, sampleId] = segments;
    if (typeKey && section === "samples" && sampleId) {
      return (
        <>
          {await SamplePage({
            config,
            adminKey: key,
            basePath,
            typeKey,
            sampleId,
            searchParams,
            i18n,
          })}
          {feedback}
        </>
      );
    }
    if (typeKey) {
      return (
        <>
          {await StudioPage({ config, adminKey: key, basePath, typeKey, searchParams, i18n })}
          {feedback}
        </>
      );
    }
    const types = await listDocTypes(qb, ctx);
    return (
      <>
        <Heading title={t("types.title")} description={t("types.description")} />
        <Card>
          {types.length === 0 ? (
            <CardBody>
              <p className="qb:text-sm qb:text-fg-muted">{t("types.empty")}</p>
            </CardBody>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("col.type")}</Th>
                  <Th>{t("col.published")}</Th>
                  <Th>{t("col.draft")}</Th>
                  <Th>{t("col.samples")}</Th>
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
                      <p className="qb:text-xs qb:text-fg-muted qb:font-mono">
                        {type.key}
                        {type.builtin ? ` · ${t("types.builtin")}` : ""}
                      </p>
                    </Td>
                    <Td>
                      {type.published ? (
                        <span className="qb:text-sm">
                          <Badge tone="green">
                            {t("version.short", { version: type.published.version })}
                          </Badge>{" "}
                          <span className="qb:text-fg-muted">
                            {formatWhen(i18n, type.published.publishedAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="qb:text-fg-subtle">{EMPTY}</span>
                      )}
                    </Td>
                    <Td>
                      {type.draft ? (
                        <Badge tone="amber">
                          {t("version.short", { version: type.draft.version })}
                        </Badge>
                      ) : (
                        <span className="qb:text-fg-subtle">{EMPTY}</span>
                      )}
                    </Td>
                    <Td className="qb:tabular-nums">{type.samples}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <CreateTypeForm action={create} t={t} />
        {feedback}
      </>
    );
  };
}
