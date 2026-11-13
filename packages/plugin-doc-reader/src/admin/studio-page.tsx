import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Input,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
} from "@quickben/admin/ui";
import { getQuickben } from "@quickben/core";
import { getRequestContext } from "@quickben/next";
import Link from "next/link";

import { FIELD_TRANSFORMS, FIELD_TYPES } from "../definition";
import { TEXT_LAYER } from "../extractors/text-layer";
import { VISION_LLM } from "../extractors/vision-llm";
import { getDocReader } from "../options";
import {
  canPublish,
  getVersion,
  listSamples,
  listTestRuns,
  listVersions,
  sampleFile,
} from "../studio";

import {
  addSamplesAction,
  createDraftAction,
  deleteDraftAction,
  publishAction,
  removeSampleAction,
  saveDraftAction,
  startTestAction,
  updateSampleAction,
} from "./actions";
import { AutoRefresh, FilePreview } from "./client";
import {
  AlignedSubmit,
  Field,
  first,
  formatMs,
  formatPercent,
  formatUsd,
  formatWhen,
  Heading,
  linkClass,
  Notice,
  PREVIEW_MAX_BYTES,
  StateBadge,
  Stat,
  StatusBadge,
  toBase64,
} from "./shared";

import type { DocumentType, FieldDefinition, ParamDefinition, PipelineStep } from "../definition";
import type { ModelChoice } from "../models";
import type { DocReaderState } from "../options";
import type { Sample, TestRun, TypeVersion, VersionSummary } from "../studio";
import type { SearchParams } from "./shared";
import type { Quickben, QuickbenConfig, RequestContext } from "@quickben/core";
import type { ReactNode } from "react";

type Action = (formData: FormData) => Promise<void>;

interface Actions {
  createDraft: Action;
  saveDraft: Action;
  deleteDraft: Action;
  publish: Action;
  addSamples: Action;
  updateSample: Action;
  removeSample: Action;
  startTest: Action;
}

function bind(adminKey: string): Actions {
  return {
    createDraft: createDraftAction.bind(null, adminKey),
    saveDraft: saveDraftAction.bind(null, adminKey),
    deleteDraft: deleteDraftAction.bind(null, adminKey),
    publish: publishAction.bind(null, adminKey),
    addSamples: addSamplesAction.bind(null, adminKey),
    updateSample: updateSampleAction.bind(null, adminKey),
    removeSample: removeSampleAction.bind(null, adminKey),
    startTest: startTestAction.bind(null, adminKey),
  };
}

function Hidden({ values }: Readonly<{ values: Record<string, string | number> }>) {
  return (
    <>
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={String(value)} />
      ))}
    </>
  );
}

/** The version to open: the draft if there is one, else the newest. */
export function initialVersion(versions: readonly VersionSummary[]): number | undefined {
  return (versions.find((v) => v.state === "draft") ?? versions[0])?.version;
}

// ---------------------------------------------------------------------------------------------
// Editor

const id = (...parts: (string | number)[]) => `qb-dr-${parts.join("-")}`;

function FieldRow({ field, index }: Readonly<{ field: FieldDefinition | null; index: number }>) {
  const p = `fields.${String(index)}.`;
  const name = field?.label ?? `new field`;
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6 qb:border-b qb:border-zinc-100 qb:py-4">
      <Field label="Key" htmlFor={id("field", index, "key")}>
        <Input
          id={id("field", index, "key")}
          name={`${p}key`}
          defaultValue={field?.key ?? ""}
          placeholder="invoiceNumber"
        />
      </Field>
      <Field label="Name" htmlFor={id("field", index, "label")} className="qb:md:col-span-2">
        <Input
          id={id("field", index, "label")}
          name={`${p}label`}
          defaultValue={field?.label ?? ""}
          placeholder={field ? "" : "Add a field"}
        />
      </Field>
      <Field label="Type" htmlFor={id("field", index, "type")}>
        <Select
          id={id("field", index, "type")}
          name={`${p}type`}
          defaultValue={field?.type ?? "text"}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Transform" htmlFor={id("field", index, "transform")}>
        <Select
          id={id("field", index, "transform")}
          name={`${p}transform`}
          defaultValue={field?.transform ?? ""}
        >
          <option value="">none</option>
          {FIELD_TRANSFORMS.map((transform) => (
            <option key={transform} value={transform}>
              {transform}
            </option>
          ))}
        </Select>
      </Field>
      <div className="qb:flex qb:flex-col qb:gap-2 qb:text-sm">
        <label className="qb:flex qb:items-center qb:gap-2">
          <Checkbox
            name={`${p}required`}
            defaultChecked={field?.required ?? false}
            aria-label={`${name} is required`}
          />
          Required
        </label>
        {field ? (
          <label className="qb:flex qb:items-center qb:gap-2">
            <Checkbox name={`${p}remove`} aria-label={`Remove ${name}`} />
            Remove
          </label>
        ) : null}
      </div>
      <Field
        label="Description"
        htmlFor={id("field", index, "description")}
        className="qb:md:col-span-3"
        hint="Helps people and the model find the value."
      >
        <Input
          id={id("field", index, "description")}
          name={`${p}description`}
          defaultValue={field?.description ?? ""}
        />
      </Field>
      <Field
        label="Pattern"
        htmlFor={id("field", index, "pattern")}
        className="qb:md:col-span-2"
        hint="Regular expression the value must match."
      >
        <Input
          id={id("field", index, "pattern")}
          name={`${p}pattern`}
          defaultValue={field?.pattern ?? ""}
          className="qb:font-mono"
        />
      </Field>
      {field?.type === "date" ? (
        <Field label="Date order" htmlFor={id("field", index, "dateOrder")}>
          <Select
            id={id("field", index, "dateOrder")}
            name={`${p}dateOrder`}
            defaultValue={field.dateOrder ?? "dmy"}
          >
            <option value="dmy">day/month/year</option>
            <option value="mdy">month/day/year</option>
          </Select>
        </Field>
      ) : null}
      {field?.type === "number" ? (
        <Field label="Decimal separator" htmlFor={id("field", index, "decimal")}>
          <Select
            id={id("field", index, "decimal")}
            name={`${p}decimalSeparator`}
            defaultValue={field.decimalSeparator ?? "."}
          >
            <option value=".">. (1,234.50)</option>
            <option value=",">, (1.234,50)</option>
          </Select>
        </Field>
      ) : null}
    </div>
  );
}

function ParamRow({ param, index }: Readonly<{ param: ParamDefinition | null; index: number }>) {
  const p = `params.${String(index)}.`;
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6 qb:border-b qb:border-zinc-100 qb:py-4">
      <Field label="Key" htmlFor={id("param", index, "key")}>
        <Input
          id={id("param", index, "key")}
          name={`${p}key`}
          defaultValue={param?.key ?? ""}
          placeholder={param ? "" : "Add a parameter"}
        />
      </Field>
      <Field label="Name" htmlFor={id("param", index, "label")} className="qb:md:col-span-2">
        <Input
          id={id("param", index, "label")}
          name={`${p}label`}
          defaultValue={param?.label ?? ""}
        />
      </Field>
      <Field label="Type" htmlFor={id("param", index, "type")}>
        <Select
          id={id("param", index, "type")}
          name={`${p}type`}
          defaultValue={param?.type ?? "string"}
        >
          <option value="string">text</option>
          <option value="string-list">list of texts</option>
        </Select>
      </Field>
      <Field
        label="Never the value of"
        htmlFor={id("param", index, "excludes")}
        hint="Field keys, comma-separated."
      >
        <Input
          id={id("param", index, "excludes")}
          name={`${p}excludes`}
          defaultValue={param?.excludes.join(", ") ?? ""}
        />
      </Field>
      {param ? (
        <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
          <Checkbox name={`${p}remove`} aria-label={`Remove parameter ${param.key}`} />
          Remove
        </label>
      ) : null}
    </div>
  );
}

function others(config: Readonly<Record<string, unknown>>, typed: readonly string[]): string {
  const rest = Object.fromEntries(Object.entries(config).filter(([key]) => !typed.includes(key)));
  return Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "";
}

function Options({ values, current }: Readonly<{ values: readonly string[]; current: string }>) {
  const all = current && !values.includes(current) ? [current, ...values] : values;
  return (
    <>
      <option value="">—</option>
      {all.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </>
  );
}

const extractorLabels: Readonly<Record<string, string>> = {
  [TEXT_LAYER]: "text-layer (free: the PDF's text)",
  [VISION_LLM]: "vision-llm (paid: a vision model)",
};

interface StepInputsProps {
  readonly index: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly state: DocReaderState;
  readonly models: readonly ModelChoice[];
}

const configText = (config: Readonly<Record<string, unknown>>, key: string) => {
  const value = config[key];
  return typeof value === "string" ? value : "";
};

function TextLayerInputs({ index, config, state }: StepInputsProps) {
  const p = `steps.${String(index)}.`;
  return (
    <>
      <Field label="Template" htmlFor={id("step", index, "template")} className="qb:md:col-span-3">
        <Select
          id={id("step", index, "template")}
          name={`${p}template`}
          defaultValue={configText(config, "template")}
        >
          <Options values={state.templateKeys} current={configText(config, "template")} />
        </Select>
      </Field>
      <Field label="Reader" htmlFor={id("step", index, "reader")} className="qb:md:col-span-3">
        <Select
          id={id("step", index, "reader")}
          name={`${p}reader`}
          defaultValue={configText(config, "reader")}
        >
          <Options values={state.readerKeys} current={configText(config, "reader")} />
        </Select>
      </Field>
    </>
  );
}

function ConnectionInput({ index, config, models }: StepInputsProps) {
  const name = `steps.${String(index)}.connectionId`;
  const connection = configText(config, "connectionId");
  if (models.length === 0) {
    return <Input id={id("step", index, "connection")} name={name} defaultValue={connection} />;
  }
  const known = models.some((choice) => choice.connectionId === connection);
  return (
    <Select id={id("step", index, "connection")} name={name} defaultValue={connection}>
      <option value="">—</option>
      {models.map((choice) => (
        <option key={choice.connectionId} value={choice.connectionId}>
          {choice.connectionName}
        </option>
      ))}
      {connection && !known ? <option value={connection}>{connection}</option> : null}
    </Select>
  );
}

function VisionInputs(props: StepInputsProps) {
  const { index, config, models } = props;
  const p = `steps.${String(index)}.`;
  const listId = id("models", index);
  return (
    <>
      <Field
        label="Connection"
        htmlFor={id("step", index, "connection")}
        className="qb:md:col-span-2"
      >
        <ConnectionInput {...props} />
      </Field>
      <Field
        label="Model"
        htmlFor={id("step", index, "model")}
        className="qb:md:col-span-2"
        hint="Empty: the connection's default model."
      >
        <Input
          id={id("step", index, "model")}
          name={`${p}model`}
          defaultValue={configText(config, "model")}
          list={listId}
        />
        <datalist id={listId}>
          {models.flatMap((choice) =>
            choice.models.map((model) => (
              <option
                key={`${choice.connectionId}-${model.id}`}
                value={model.id}
                label={`${choice.connectionName} · ${model.label ?? model.id}`}
              />
            )),
          )}
        </datalist>
      </Field>
      <Field
        label="Max pages"
        htmlFor={id("step", index, "maxPages")}
        hint="Empty: the model's limit."
      >
        <Input
          id={id("step", index, "maxPages")}
          name={`${p}maxPages`}
          type="number"
          min={1}
          defaultValue={typeof config.maxPages === "number" ? config.maxPages : ""}
        />
      </Field>
    </>
  );
}

function StepRow({
  step,
  index,
  state,
  models,
}: Readonly<{
  step: PipelineStep | null;
  index: number;
  state: DocReaderState;
  models: readonly ModelChoice[];
}>) {
  const p = `steps.${String(index)}.`;
  const inputs = { index, config: step?.config ?? {}, state, models };
  const typed =
    step?.extractor === VISION_LLM ? ["connectionId", "model", "maxPages"] : ["template", "reader"];
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6 qb:border-b qb:border-zinc-100 qb:py-4">
      <Field label="Order" htmlFor={id("step", index, "order")}>
        <Input
          id={id("step", index, "order")}
          name={`${p}order`}
          type="number"
          min={1}
          defaultValue={index + 1}
        />
      </Field>
      <Field
        label={step ? "Extractor" : "Add a step"}
        htmlFor={id("step", index, "extractor")}
        className="qb:md:col-span-2"
      >
        <Select
          id={id("step", index, "extractor")}
          name={`${p}extractor`}
          defaultValue={step?.extractor ?? ""}
        >
          {step ? null : <option value="">—</option>}
          {Object.keys(state.extractors).map((key) => (
            <option key={key} value={key}>
              {extractorLabels[key] ?? key}
            </option>
          ))}
        </Select>
      </Field>
      {step ? (
        <>
          <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
            <Checkbox name={`${p}remove`} aria-label={`Remove step ${String(index + 1)}`} />
            Remove
          </label>
          {step.extractor === TEXT_LAYER ? <TextLayerInputs {...inputs} /> : null}
          {step.extractor === VISION_LLM ? <VisionInputs {...inputs} /> : null}
          <Field
            label="Other settings (JSON)"
            htmlFor={id("step", index, "config")}
            className="qb:md:col-span-6"
          >
            <Textarea
              id={id("step", index, "config")}
              name={`${p}config`}
              className="qb:font-mono"
              defaultValue={others(step.config, typed)}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: string; children: ReactNode }>) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function Editor({
  version,
  state,
  models,
  save,
}: Readonly<{
  version: TypeVersion;
  state: DocReaderState;
  models: readonly ModelChoice[];
  save: Action;
}>) {
  const type: DocumentType = version.definition;
  const draft = version.state === "draft";
  const fields: (FieldDefinition | null)[] = [...type.fields, null];
  const params: (ParamDefinition | null)[] = [...type.params, null];
  const steps: (PipelineStep | null)[] = [...type.pipeline.steps, null];
  return (
    <form action={save}>
      <Hidden
        values={{
          typeKey: version.key,
          version: version.version,
          fieldCount: fields.length,
          paramCount: params.length,
          stepCount: steps.length,
        }}
      />
      <fieldset disabled={!draft} className="qb:space-y-4">
        <legend className="qb:sr-only">Definition of {version.label}</legend>
        {draft ? null : (
          <Notice>Published versions cannot change. Create a draft to edit this type.</Notice>
        )}
        <Section title="General">
          <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:md:grid-cols-6">
            <Field label="Name" htmlFor={id("label")} className="qb:md:col-span-3">
              <Input
                id={id("label")}
                name="label"
                defaultValue={type.label}
                required
                maxLength={120}
              />
            </Field>
            <Field
              label="Pages to read"
              htmlFor={id("pages")}
              className="qb:md:col-span-3"
              hint="Comma-separated. The first page is 1."
            >
              <Input id={id("pages")} name="pages" defaultValue={type.pages.join(", ")} />
            </Field>
            <Field label="Description" htmlFor={id("description")} className="qb:md:col-span-6">
              <Input
                id={id("description")}
                name="description"
                defaultValue={type.description ?? ""}
                placeholder="What the document is and who issues it"
              />
            </Field>
          </div>
        </Section>
        <Section
          title="Fields"
          description="What is read from the document. Required fields decide whether a reading is complete."
        >
          {fields.map((field, index) => (
            <FieldRow key={field?.key ?? "new"} field={field} index={index} />
          ))}
        </Section>
        <Section
          title="Instructions"
          description="Extra text for vision models: where each value is, what not to confuse."
        >
          <Textarea
            aria-label="Instructions"
            name="instructions"
            defaultValue={type.instructions}
          />
        </Section>
        <Section
          title="Recognition"
          description="For readings with type auto. Regular expressions, one per line."
        >
          <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2">
            <Field label="Text on the first page" htmlFor={id("classText")}>
              <Textarea
                id={id("classText")}
                name="classText"
                className="qb:font-mono"
                defaultValue={type.classification.text.join("\n")}
              />
            </Field>
            <Field label="File name" htmlFor={id("classFileName")}>
              <Textarea
                id={id("classFileName")}
                name="classFileName"
                className="qb:font-mono"
                defaultValue={type.classification.fileName.join("\n")}
              />
            </Field>
          </div>
        </Section>
        <Section
          title="Parameters"
          description="Values callers pass with a reading, e.g. the issuer's own tax ids."
        >
          {params.map((param, index) => (
            <ParamRow key={param?.key ?? "new"} param={param} index={index} />
          ))}
        </Section>
        <Section
          title="Reading"
          description="Steps run in order and stop once the fields the rule asks for are read."
        >
          {steps.map((step, index) => (
            <StepRow key={index} step={step} index={index} state={state} models={models} />
          ))}
          <div className="qb:mt-5 qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2">
            <Field
              label="Minimum confidence"
              htmlFor={id("threshold")}
              hint="0 to 1. Below it, a field goes on to the next step."
            >
              <Input
                id={id("threshold")}
                name="threshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                defaultValue={type.pipeline.threshold}
              />
            </Field>
            <Field label="Stop when read" htmlFor={id("stopWhen")}>
              <Select id={id("stopWhen")} name="stopWhen" defaultValue={type.pipeline.stopWhen}>
                <option value="required">the required fields</option>
                <option value="all">all fields</option>
              </Select>
            </Field>
          </div>
        </Section>
        {draft ? (
          <div className="qb:flex">
            <Button type="submit">Save draft</Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Test bench

function SampleEditor({
  sample,
  version,
  preview,
  update,
}: Readonly<{ sample: Sample; version: TypeVersion; preview: ReactNode; update: Action }>) {
  const type = version.definition;
  return (
    <Card className="qb:mt-5">
      <CardHeader
        title={`Expected values · ${sample.fileName}`}
        description="What the document says. Readings are compared with it. Leave a value empty to skip it."
      />
      <CardBody>
        <div className="qb:grid qb:grid-cols-1 qb:gap-6 qb:md:grid-cols-6">
          <form action={update} className="qb:space-y-4 qb:md:col-span-3">
            <Hidden
              values={{ typeKey: version.key, version: version.version, sampleId: sample.id }}
            />
            {type.fields.map((field) => (
              <Field
                key={field.key}
                label={field.required ? `${field.label} *` : field.label}
                htmlFor={id("expected", field.key)}
              >
                <Input
                  id={id("expected", field.key)}
                  name={`expected.${field.key}`}
                  defaultValue={sample.expected[field.key] ?? ""}
                />
              </Field>
            ))}
            {type.params.map((param) => {
              const value = sample.params[param.key];
              return (
                <Field
                  key={param.key}
                  label={`Parameter: ${param.label}`}
                  htmlFor={id("sample-param", param.key)}
                  hint={param.type === "string-list" ? "Comma-separated." : undefined}
                >
                  <Input
                    id={id("sample-param", param.key)}
                    name={`params.${param.key}`}
                    defaultValue={Array.isArray(value) ? value.join(", ") : (value ?? "")}
                  />
                </Field>
              );
            })}
            <Field label="Note" htmlFor={id("note")}>
              <Input
                id={id("note")}
                name="note"
                defaultValue={sample.note ?? ""}
                placeholder="e.g. a crooked scan"
              />
            </Field>
            <Button type="submit">Save values</Button>
          </form>
          <div className="qb:min-w-0 qb:md:col-span-3">{preview}</div>
        </div>
      </CardBody>
    </Card>
  );
}

function variantLabel(run: TestRun, models: readonly ModelChoice[]): string {
  if (!run.variant) return "This version";
  const connection = models.find((c) => c.connectionId === run.variant?.connectionId);
  return [
    connection?.connectionName ?? run.variant.connectionId,
    run.variant.model ?? "default model",
  ].join(" · ");
}

function RunCard({ run, label }: Readonly<{ run: TestRun; label: string }>) {
  const summary = run.summary;
  const fields = run.results[0]?.fields.map((f) => f.label) ?? [];
  return (
    <Card>
      <CardHeader
        title={label}
        description={formatWhen(run.createdAt)}
        actions={<StateBadge state={run.state} />}
      />
      <CardBody className="qb:space-y-4">
        <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:xl:grid-cols-3">
          <Stat label="Matches">
            {summary && summary.checked > 0
              ? `${formatPercent(summary.accuracy)} (${String(summary.matched)}/${String(summary.checked)})`
              : "—"}
          </Stat>
          <Stat label="Cost">{formatUsd(run.costUsd)}</Stat>
          <Stat label="Average time">{summary ? formatMs(summary.avgLatencyMs) : "—"}</Stat>
        </div>
        {run.error ? <p className="qb:text-sm qb:text-red-700">{run.error}</p> : null}
      </CardBody>
      {run.results.length > 0 ? (
        <Table aria-label={`Results of ${label}`}>
          <thead>
            <tr>
              <Th>Sample</Th>
              {fields.map((name) => (
                <Th key={name}>{name}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.results.map((result) => (
              <Tr key={result.sampleId}>
                <Td>
                  <p className="qb:font-medium qb:text-zinc-900">{result.fileName}</p>
                  <StatusBadge status={result.status} />
                  {result.error ? (
                    <p className="qb:text-xs qb:text-red-700">{result.error}</p>
                  ) : null}
                </Td>
                {result.fields.map((check) => (
                  <Td key={check.key}>
                    <span className="qb:font-mono qb:text-sm">{check.read ?? "—"}</span>{" "}
                    {check.match === true ? <Badge tone="green">match</Badge> : null}
                    {check.match === false ? (
                      <Badge tone="red">expected {check.expected}</Badge>
                    ) : null}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </Card>
  );
}

function ModelPicker({
  prefix,
  label,
  models,
}: Readonly<{ prefix: string; label: string; models: readonly ModelChoice[] }>) {
  if (models.length > 0) {
    return (
      <Field label={label} htmlFor={id("variant", prefix)}>
        <Select id={id("variant", prefix)} name={`${prefix}.choice`} required>
          <option value="">Choose a model</option>
          {models.flatMap((choice) => [
            <option key={choice.connectionId} value={choice.connectionId}>
              {choice.connectionName} · default model
            </option>,
            ...choice.models.map((model) => (
              <option
                key={`${choice.connectionId}|${model.id}`}
                value={`${choice.connectionId}|${model.id}`}
              >
                {choice.connectionName} · {model.label ?? model.id}
              </option>
            )),
          ])}
        </Select>
      </Field>
    );
  }
  return (
    <div className="qb:flex qb:flex-wrap qb:gap-4">
      <Field label={`${label}: connection id`} htmlFor={id("variant", prefix, "connection")}>
        <Input id={id("variant", prefix, "connection")} name={`${prefix}.connectionId`} required />
      </Field>
      <Field label={`${label}: model`} htmlFor={id("variant", prefix, "model")}>
        <Input id={id("variant", prefix, "model")} name={`${prefix}.model`} />
      </Field>
    </div>
  );
}

function Bench({
  version,
  samples,
  runs,
  models,
  sampleParam,
  runParam,
  basePath,
  preview,
  actions,
}: Readonly<{
  version: TypeVersion;
  samples: readonly Sample[];
  runs: readonly TestRun[];
  models: readonly ModelChoice[];
  sampleParam: string | undefined;
  runParam: string | undefined;
  basePath: string;
  preview: ReactNode;
  actions: Actions;
}>) {
  const href = (query: Record<string, string>) =>
    `${basePath}/document-types/${encodeURIComponent(version.key)}?${new URLSearchParams({ v: String(version.version), tab: "bench", ...query }).toString()}`;
  const editing = samples.find((sample) => sample.id === sampleParam);
  const selected = runs.find((run) => run.id === runParam) ?? runs[0];
  const group = selected?.compareGroup;
  let shown: TestRun[] = [];
  if (group) shown = runs.filter((run) => run.compareGroup === group);
  else if (selected) shown = [selected];
  const keys = { typeKey: version.key, version: version.version };
  return (
    <div className="qb:space-y-4">
      <Card>
        <CardHeader
          title="Samples"
          description="Real documents with the values they should read to. They belong to the type, so every version is tested on them."
        />
        {samples.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Expected values</Th>
                <Th>Note</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {samples.map((sample) => (
                <Tr key={sample.id}>
                  <Td>
                    <Link href={href({ sample: sample.id })} className={linkClass}>
                      {sample.fileName}
                    </Link>
                  </Td>
                  <Td>
                    {Object.keys(sample.expected).length} of {version.definition.fields.length}
                  </Td>
                  <Td>{sample.note ?? ""}</Td>
                  <Td>
                    <form action={actions.removeSample}>
                      <Hidden values={{ ...keys, sampleId: sample.id }} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${sample.fileName}`}
                      >
                        Remove
                      </Button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : null}
        <CardBody>
          <form
            action={actions.addSamples}
            className="qb:flex qb:flex-wrap qb:items-start qb:gap-4"
          >
            <Hidden values={keys} />
            <Field
              label="Add samples"
              htmlFor={id("samples")}
              hint="PDF, JPEG, PNG or WebP. Then open each one to enter its expected values."
            >
              <Input
                id={id("samples")}
                name="files"
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp"
              />
            </Field>
            <AlignedSubmit>
              <Button type="submit" variant="secondary">
                Upload
              </Button>
            </AlignedSubmit>
          </form>
        </CardBody>
      </Card>
      {editing ? (
        <SampleEditor
          sample={editing}
          version={version}
          preview={preview}
          update={actions.updateSample}
        />
      ) : null}
      <Card>
        <CardHeader
          title="Test"
          description="Reads every sample and compares each field with its expected value. Paid steps are billed to the platform."
        />
        <CardBody className="qb:space-y-4">
          <form action={actions.startTest}>
            <Hidden values={{ ...keys, mode: "version" }} />
            <Button type="submit" disabled={samples.length === 0}>
              Test this version on {samples.length} {samples.length === 1 ? "sample" : "samples"}
            </Button>
          </form>
          <form
            action={actions.startTest}
            className="qb:space-y-3 qb:border-t qb:border-zinc-100 qb:pt-4"
          >
            <Hidden values={{ ...keys, mode: "compare" }} />
            <p className="qb:text-sm qb:text-zinc-600">
              Compare two models side by side. Each model reads alone, without the other steps, to
              show the difference.
            </p>
            <div className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
              <ModelPicker prefix="a" label="Model A" models={models} />
              <ModelPicker prefix="b" label="Model B" models={models} />
              <Button type="submit" variant="secondary" disabled={samples.length === 0}>
                Compare models
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      {shown.some((run) => run.state === "running") ? <AutoRefresh /> : null}
      {shown.length > 0 ? (
        <div
          className="qb:grid qb:gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(24rem, 100%), 1fr))" }}
        >
          {shown.map((run) => (
            <RunCard key={run.id} run={run} label={variantLabel(run, models)} />
          ))}
        </div>
      ) : null}
      {runs.length > 1 ? (
        <Card>
          <CardHeader title="Earlier tests" />
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th>State</Th>
                <Th>Matches</Th>
                <Th>Cost</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Tr key={run.id}>
                  <Td>
                    <Link href={href({ run: run.id })} className={linkClass}>
                      {formatWhen(run.createdAt)}
                    </Link>
                  </Td>
                  <Td>
                    {run.compareGroup
                      ? `Comparison: ${variantLabel(run, models)}`
                      : variantLabel(run, models)}
                  </Td>
                  <Td>
                    <StateBadge state={run.state} />
                  </Td>
                  <Td>{formatPercent(run.summary?.accuracy ?? null)}</Td>
                  <Td>{formatUsd(run.costUsd)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Page

async function previewOf(
  qb: Quickben,
  ctx: RequestContext,
  sample: Sample | undefined,
): Promise<ReactNode> {
  if (!sample) return null;
  if ((sample.size ?? 0) > PREVIEW_MAX_BYTES)
    return <p className="qb:text-sm qb:text-zinc-500">The file is too large to preview.</p>;
  try {
    const file = await sampleFile(qb, ctx, sample.id);
    return <FilePreview base64={toBase64(file.bytes)} mime={file.mime} name={file.fileName} />;
  } catch {
    return <p className="qb:text-sm qb:text-red-700">The file of this sample is gone.</p>;
  }
}

async function modelChoices(state: DocReaderState): Promise<readonly ModelChoice[]> {
  if (!state.listModels) return [];
  try {
    return await state.listModels();
  } catch (error) {
    state.log("list-models-failed", { error: String(error) });
    return [];
  }
}

/** One type: its versions, the editor of the chosen one and the test bench. */
export async function StudioPage({
  config,
  adminKey,
  basePath,
  typeKey,
  searchParams,
}: Readonly<{
  config: QuickbenConfig;
  adminKey: string;
  basePath: string;
  typeKey: string;
  searchParams: SearchParams;
}>) {
  const qb = await getQuickben(config);
  const ctx = await getRequestContext(config);
  const state = getDocReader(qb);
  const actions = bind(adminKey);
  let versions: VersionSummary[];
  try {
    versions = await listVersions(qb, ctx, typeKey);
  } catch {
    return (
      <>
        <Heading title="Document type not found" />
        <Notice>
          There is no document type <span className="qb:font-mono">{typeKey}</span>.{" "}
          <Link href={`${basePath}/document-types`} className={linkClass}>
            Back to document types
          </Link>
        </Notice>
      </>
    );
  }
  const asked = Number(first(searchParams.v));
  const number = versions.some((v) => v.version === asked)
    ? asked
    : (initialVersion(versions) ?? 1);
  const tab = first(searchParams.tab) === "bench" ? "bench" : "definition";
  const [version, runs, samples, models] = await Promise.all([
    getVersion(qb, ctx, typeKey, number),
    listTestRuns(qb, ctx, typeKey, number),
    listSamples(qb, ctx, typeKey),
    modelChoices(state),
  ]);
  const draft = versions.find((v) => v.state === "draft");
  const publishable = canPublish(version, runs);
  const keys = { typeKey, version: number };
  const tabHref = (name: string) =>
    `${basePath}/document-types/${encodeURIComponent(typeKey)}?v=${String(number)}&tab=${name}`;
  const sampleParam = first(searchParams.sample);

  return (
    <>
      <p className="qb:mb-3 qb:text-sm">
        <Link href={`${basePath}/document-types`} className={linkClass}>
          ← Document types
        </Link>
      </p>
      <Heading
        title={version.label}
        description={
          <>
            <span className="qb:font-mono">{typeKey}</span> · v{version.version} ·{" "}
            <StateBadge state={version.state} />
            {version.publishedAt ? ` · published ${formatWhen(version.publishedAt)}` : ""}
          </>
        }
        actions={
          <>
            {version.state === "draft" ? (
              <>
                <form action={actions.publish}>
                  <Hidden values={keys} />
                  <Button
                    type="submit"
                    disabled={!publishable}
                    title={publishable ? undefined : "Test this version first"}
                  >
                    Publish v{version.version}
                  </Button>
                </form>
                <form action={actions.deleteDraft}>
                  <Hidden values={keys} />
                  <Button type="submit" variant="danger">
                    Delete draft
                  </Button>
                </form>
              </>
            ) : null}
            {draft ? null : (
              <form action={actions.createDraft}>
                <Hidden values={{ typeKey, from: number }} />
                <Button type="submit" variant="secondary">
                  New draft from v{version.version}
                </Button>
              </form>
            )}
          </>
        }
      />
      <nav aria-label="Versions" className="qb:mb-3 qb:flex qb:flex-wrap qb:gap-2">
        {versions.map((v) => (
          <ButtonLink
            key={v.version}
            href={`${basePath}/document-types/${encodeURIComponent(typeKey)}?v=${String(v.version)}&tab=${tab}`}
            size="sm"
            variant={v.version === number ? "primary" : "ghost"}
            aria-current={v.version === number ? "page" : undefined}
          >
            v{v.version} · {v.state}
          </ButtonLink>
        ))}
      </nav>
      <nav
        aria-label="Sections"
        className="qb:mb-6 qb:flex qb:gap-2 qb:border-b qb:border-zinc-200 qb:pb-4"
      >
        <ButtonLink
          href={tabHref("definition")}
          size="sm"
          variant={tab === "definition" ? "secondary" : "ghost"}
          aria-current={tab === "definition" ? "page" : undefined}
        >
          Definition
        </ButtonLink>
        <ButtonLink
          href={tabHref("bench")}
          size="sm"
          variant={tab === "bench" ? "secondary" : "ghost"}
          aria-current={tab === "bench" ? "page" : undefined}
        >
          Test bench ({samples.length})
        </ButtonLink>
      </nav>
      {version.state === "draft" && !publishable ? (
        <p className="qb:mb-3 qb:text-sm qb:text-zinc-500">
          Publishing needs a finished test of this version, as it is now, on the test bench.
        </p>
      ) : null}
      {tab === "definition" ? (
        <Editor version={version} state={state} models={models} save={actions.saveDraft} />
      ) : (
        <Bench
          version={version}
          samples={samples}
          runs={runs}
          models={models}
          sampleParam={sampleParam}
          runParam={first(searchParams.run)}
          basePath={basePath}
          preview={await previewOf(
            qb,
            ctx,
            samples.find((s) => s.id === sampleParam),
          )}
          actions={actions}
        />
      )}
    </>
  );
}
