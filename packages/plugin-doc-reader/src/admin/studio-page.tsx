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

import { compareTestRuns } from "../bench";
import { FIELD_TRANSFORMS, FIELD_TYPES } from "../definition";
import { TEXT_LAYER } from "../extractors/text-layer";
import { VISION_LLM } from "../extractors/vision-llm";
import { getDocReader } from "../options";
import { isSplit, currentSplit } from "../splits";
import {
  getVersion,
  listSamples,
  listTestRuns,
  listVersions,
  publishCheck,
  sampleFile,
} from "../studio";

import {
  addSamplesAction,
  createDraftAction,
  deleteDraftAction,
  publishAction,
  removeSampleAction,
  saveDraftAction,
  splitAction,
  startTestAction,
  updateSampleAction,
} from "./actions";
import { AutoRefresh, FilePreview } from "./client";
import {
  ComparePicker,
  ComparisonView,
  ExamplesPicker,
  ExportLinks,
  HistoryCard,
  MetricsTables,
  PublishCheckNotice,
  RunOptions,
  RunStats,
  SAMPLES_PER_PAGE,
  SampleFilter,
  SplitBadge,
  SplitCard,
} from "./evals";
import { docReaderT, stateLabel } from "./messages";
import {
  AlignedSubmit,
  EMPTY,
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

import type { Split } from "../collections";
import type { DocumentType, FieldDefinition, ParamDefinition, PipelineStep } from "../definition";
import type { RunComparison } from "../metrics";
import type { ModelChoice } from "../models";
import type { DocReaderState } from "../options";
import type { PublishCheck } from "../publish";
import type { SplitVersion } from "../splits";
import type { Sample, TestRun, TypeVersion, VersionSummary } from "../studio";
import type { DocReaderT } from "./messages";
import type { SearchParams } from "./shared";
import type { AdminI18n } from "@quickben/admin";
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
  split: Action;
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
    split: splitAction.bind(null, adminKey),
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

function FieldRow({
  field,
  index,
  t,
}: Readonly<{ field: FieldDefinition | null; index: number; t: DocReaderT }>) {
  const p = `fields.${String(index)}.`;
  const name = field?.label ?? t("field.newName");
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6 qb:border-b qb:border-line-soft qb:py-4">
      <Field label={t("field.key")} htmlFor={id("field", index, "key")}>
        <Input
          id={id("field", index, "key")}
          name={`${p}key`}
          defaultValue={field?.key ?? ""}
          placeholder={t("field.keyPlaceholder")}
        />
      </Field>
      <Field
        label={t("field.name")}
        htmlFor={id("field", index, "label")}
        className="qb:md:col-span-2"
      >
        <Input
          id={id("field", index, "label")}
          name={`${p}label`}
          defaultValue={field?.label ?? ""}
          placeholder={field ? "" : t("field.add")}
        />
      </Field>
      <Field label={t("field.type")} htmlFor={id("field", index, "type")}>
        <Select
          id={id("field", index, "type")}
          name={`${p}type`}
          defaultValue={field?.type ?? "text"}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`fieldType.${type}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("field.transform")} htmlFor={id("field", index, "transform")}>
        <Select
          id={id("field", index, "transform")}
          name={`${p}transform`}
          defaultValue={field?.transform ?? ""}
        >
          <option value="">{t("transform.none")}</option>
          {FIELD_TRANSFORMS.map((transform) => (
            <option key={transform} value={transform}>
              {t(`transform.${transform}`)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="qb:flex qb:flex-col qb:gap-2 qb:text-sm">
        <label className="qb:flex qb:items-center qb:gap-2">
          <Checkbox
            name={`${p}required`}
            defaultChecked={field?.required ?? false}
            aria-label={t("field.requiredAria", { name })}
          />
          {t("field.required")}
        </label>
        <label className="qb:flex qb:items-center qb:gap-2">
          <Checkbox
            name={`${p}unscored`}
            defaultChecked={field?.scored === false}
            aria-label={t("field.unscoredAria", { name })}
          />
          {t("field.unscored")}
        </label>
        {field ? (
          <label className="qb:flex qb:items-center qb:gap-2">
            <Checkbox name={`${p}remove`} aria-label={t("field.removeAria", { name })} />
            {t("field.remove")}
          </label>
        ) : null}
      </div>
      <Field
        label={t("field.description")}
        htmlFor={id("field", index, "description")}
        className="qb:md:col-span-3"
        hint={t("field.descriptionHint")}
      >
        <Input
          id={id("field", index, "description")}
          name={`${p}description`}
          defaultValue={field?.description ?? ""}
        />
      </Field>
      <Field
        label={t("field.pattern")}
        htmlFor={id("field", index, "pattern")}
        className="qb:md:col-span-2"
        hint={t("field.patternHint")}
      >
        <Input
          id={id("field", index, "pattern")}
          name={`${p}pattern`}
          defaultValue={field?.pattern ?? ""}
          className="qb:font-mono"
        />
      </Field>
      {field?.type === "date" ? (
        <Field label={t("field.dateOrder")} htmlFor={id("field", index, "dateOrder")}>
          <Select
            id={id("field", index, "dateOrder")}
            name={`${p}dateOrder`}
            defaultValue={field.dateOrder ?? "dmy"}
          >
            <option value="dmy">{t("field.dmy")}</option>
            <option value="mdy">{t("field.mdy")}</option>
          </Select>
        </Field>
      ) : null}
      {field?.type === "number" ? (
        <Field label={t("field.decimal")} htmlFor={id("field", index, "decimal")}>
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

function ParamRow({
  param,
  index,
  t,
}: Readonly<{ param: ParamDefinition | null; index: number; t: DocReaderT }>) {
  const p = `params.${String(index)}.`;
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6 qb:border-b qb:border-line-soft qb:py-4">
      <Field label={t("field.key")} htmlFor={id("param", index, "key")}>
        <Input
          id={id("param", index, "key")}
          name={`${p}key`}
          defaultValue={param?.key ?? ""}
          placeholder={param ? "" : t("param.add")}
        />
      </Field>
      <Field
        label={t("field.name")}
        htmlFor={id("param", index, "label")}
        className="qb:md:col-span-2"
      >
        <Input
          id={id("param", index, "label")}
          name={`${p}label`}
          defaultValue={param?.label ?? ""}
        />
      </Field>
      <Field label={t("param.type")} htmlFor={id("param", index, "type")}>
        <Select
          id={id("param", index, "type")}
          name={`${p}type`}
          defaultValue={param?.type ?? "string"}
        >
          <option value="string">{t("paramType.string")}</option>
          <option value="string-list">{t("paramType.string-list")}</option>
        </Select>
      </Field>
      <Field
        label={t("param.excludes")}
        htmlFor={id("param", index, "excludes")}
        hint={t("param.excludesHint")}
      >
        <Input
          id={id("param", index, "excludes")}
          name={`${p}excludes`}
          defaultValue={param?.excludes.join(", ") ?? ""}
        />
      </Field>
      {param ? (
        <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
          <Checkbox name={`${p}remove`} aria-label={t("param.removeAria", { key: param.key })} />
          {t("field.remove")}
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
      <option value="">{EMPTY}</option>
      {all.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </>
  );
}

/** The label of an extractor: built-in ones say whether they cost money. */
function extractorLabel(t: DocReaderT, key: string): string {
  if (key === TEXT_LAYER) return t("extractor.text-layer");
  if (key === VISION_LLM) return t("extractor.vision-llm");
  return key;
}

interface StepInputsProps {
  readonly t: DocReaderT;
  readonly index: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly state: DocReaderState;
  readonly models: readonly ModelChoice[];
}

const configText = (config: Readonly<Record<string, unknown>>, key: string) => {
  const value = config[key];
  return typeof value === "string" ? value : "";
};

function TextLayerInputs({ t, index, config, state }: StepInputsProps) {
  const p = `steps.${String(index)}.`;
  return (
    <>
      <Field
        label={t("step.template")}
        htmlFor={id("step", index, "template")}
        className="qb:md:col-span-3"
      >
        <Select
          id={id("step", index, "template")}
          name={`${p}template`}
          defaultValue={configText(config, "template")}
        >
          <Options values={state.templateKeys} current={configText(config, "template")} />
        </Select>
      </Field>
      <Field
        label={t("step.reader")}
        htmlFor={id("step", index, "reader")}
        className="qb:md:col-span-3"
      >
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
      <option value="">{EMPTY}</option>
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
  const { t, index, config, models } = props;
  const p = `steps.${String(index)}.`;
  const listId = id("models", index);
  return (
    <>
      <Field
        label={t("step.connection")}
        htmlFor={id("step", index, "connection")}
        className="qb:md:col-span-2"
      >
        <ConnectionInput {...props} />
      </Field>
      <Field
        label={t("step.model")}
        htmlFor={id("step", index, "model")}
        className="qb:md:col-span-2"
        hint={t("step.modelHint")}
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
        label={t("step.maxPages")}
        htmlFor={id("step", index, "maxPages")}
        hint={t("step.maxPagesHint")}
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
  t,
}: Readonly<{
  step: PipelineStep | null;
  index: number;
  state: DocReaderState;
  models: readonly ModelChoice[];
  t: DocReaderT;
}>) {
  const p = `steps.${String(index)}.`;
  const inputs = { t, index, config: step?.config ?? {}, state, models };
  const typed =
    step?.extractor === VISION_LLM ? ["connectionId", "model", "maxPages"] : ["template", "reader"];
  return (
    <div className="qb:grid qb:grid-cols-1 qb:gap-3 qb:md:grid-cols-6 qb:border-b qb:border-line-soft qb:py-4">
      <Field label={t("step.order")} htmlFor={id("step", index, "order")}>
        <Input
          id={id("step", index, "order")}
          name={`${p}order`}
          type="number"
          min={1}
          defaultValue={index + 1}
        />
      </Field>
      <Field
        label={step ? t("step.extractor") : t("step.add")}
        htmlFor={id("step", index, "extractor")}
        className="qb:md:col-span-2"
      >
        <Select
          id={id("step", index, "extractor")}
          name={`${p}extractor`}
          defaultValue={step?.extractor ?? ""}
        >
          {step ? null : <option value="">{EMPTY}</option>}
          {Object.keys(state.extractors).map((key) => (
            <option key={key} value={key}>
              {extractorLabel(t, key)}
            </option>
          ))}
        </Select>
      </Field>
      {step ? (
        <>
          <label className="qb:flex qb:items-center qb:gap-2 qb:text-sm">
            <Checkbox name={`${p}remove`} aria-label={t("step.removeAria", { step: index + 1 })} />
            {t("field.remove")}
          </label>
          {step.extractor === TEXT_LAYER ? <TextLayerInputs {...inputs} /> : null}
          {step.extractor === VISION_LLM ? <VisionInputs {...inputs} /> : null}
          <Field
            label={t("step.config")}
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
  samples,
  save,
  t,
}: Readonly<{
  version: TypeVersion;
  state: DocReaderState;
  models: readonly ModelChoice[];
  samples: readonly Sample[];
  save: Action;
  t: DocReaderT;
}>) {
  const notes = samples
    .flatMap((sample) =>
      sample.annotations.map((note) => ({
        ...note,
        sampleId: sample.id,
        fileName: sample.key ?? sample.fileName,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const gate = version.definition.evaluation.gate;
  const points = (value: number | null) => (value === null ? "" : String(value * 100));
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
          evaluationForm: 1,
        }}
      />
      <fieldset disabled={!draft} className="qb:space-y-4">
        <legend className="qb:sr-only">{t("editor.legend", { label: version.label })}</legend>
        {draft ? null : <Notice>{t("editor.readOnly")}</Notice>}
        <Section title={t("editor.general")}>
          <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:md:grid-cols-6">
            <Field label={t("field.name")} htmlFor={id("label")} className="qb:md:col-span-3">
              <Input
                id={id("label")}
                name="label"
                defaultValue={type.label}
                required
                maxLength={120}
              />
            </Field>
            <Field
              label={t("editor.pages")}
              htmlFor={id("pages")}
              className="qb:md:col-span-3"
              hint={t("editor.pagesHint")}
            >
              <Input id={id("pages")} name="pages" defaultValue={type.pages.join(", ")} />
            </Field>
            <Field
              label={t("field.description")}
              htmlFor={id("description")}
              className="qb:md:col-span-6"
            >
              <Input
                id={id("description")}
                name="description"
                defaultValue={type.description ?? ""}
                placeholder={t("editor.descriptionPlaceholder")}
              />
            </Field>
          </div>
        </Section>
        <Section title={t("editor.fields")} description={t("editor.fieldsDescription")}>
          {fields.map((field, index) => (
            <FieldRow key={field?.key ?? "new"} field={field} index={index} t={t} />
          ))}
        </Section>
        <Section title={t("editor.instructions")} description={t("editor.instructionsDescription")}>
          <Textarea
            aria-label={t("editor.instructions")}
            name="instructions"
            defaultValue={type.instructions}
          />
          {notes.length > 0 ? (
            <div className="qb:mt-5 qb:space-y-2 qb:text-sm">
              <h3 className="qb:font-semibold">{t("editor.notes")}</h3>
              <p className="qb:text-fg-muted">{t("editor.notesDescription")}</p>
              <ul className="qb:space-y-1">
                {notes.slice(0, 30).map((note) => (
                  <li key={`${note.sampleId}-${note.at}`}>
                    <span className="qb:font-mono">{note.fileName}</span>
                    {note.field ? ` · ${note.field}` : ""}: {note.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
        <Section title={t("editor.recognition")} description={t("editor.recognitionDescription")}>
          <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2">
            <Field label={t("editor.classText")} htmlFor={id("classText")}>
              <Textarea
                id={id("classText")}
                name="classText"
                className="qb:font-mono"
                defaultValue={type.classification.text.join("\n")}
              />
            </Field>
            <Field label={t("editor.classFileName")} htmlFor={id("classFileName")}>
              <Textarea
                id={id("classFileName")}
                name="classFileName"
                className="qb:font-mono"
                defaultValue={type.classification.fileName.join("\n")}
              />
            </Field>
          </div>
        </Section>
        <Section title={t("editor.params")} description={t("editor.paramsDescription")}>
          {params.map((param, index) => (
            <ParamRow key={param?.key ?? "new"} param={param} index={index} t={t} />
          ))}
        </Section>
        <Section title={t("editor.reading")} description={t("editor.readingDescription")}>
          {steps.map((step, index) => (
            <StepRow key={index} step={step} index={index} state={state} models={models} t={t} />
          ))}
          <div className="qb:mt-5 qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2">
            <Field
              label={t("editor.threshold")}
              htmlFor={id("threshold")}
              hint={t("editor.thresholdHint")}
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
            <Field label={t("editor.stopWhen")} htmlFor={id("stopWhen")}>
              <Select id={id("stopWhen")} name="stopWhen" defaultValue={type.pipeline.stopWhen}>
                <option value="required">{t("editor.stopRequired")}</option>
                <option value="all">{t("editor.stopAll")}</option>
              </Select>
            </Field>
          </div>
        </Section>
        <Section title={t("editor.examples")} description={t("editor.examplesDescription")}>
          <ExamplesPicker
            samples={samples}
            chosen={type.examples.map((example) => example.sampleId)}
            t={t}
          />
        </Section>
        <Section title={t("editor.evaluation")} description={t("editor.evaluationDescription")}>
          <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:xl:grid-cols-3">
            <Field
              label={t("editor.emptyValues")}
              htmlFor={id("emptyValues")}
              hint={t("editor.emptyValuesHint")}
            >
              <Input
                id={id("emptyValues")}
                name="emptyValues"
                defaultValue={type.evaluation.emptyValues.join(", ")}
              />
            </Field>
            {(
              [
                ["maxAccuracyDrop", gate.maxAccuracyDrop],
                ["maxFieldDrop", gate.maxFieldDrop],
                ["maxCostIncrease", gate.maxCostIncrease],
                ["maxLatencyIncrease", gate.maxLatencyIncrease],
              ] as const
            ).map(([name, value]) => (
              <Field
                key={name}
                label={t(`editor.${name}`)}
                htmlFor={id("gate", name)}
                hint={name === "maxAccuracyDrop" ? undefined : t("editor.percentHint")}
              >
                <Input
                  id={id("gate", name)}
                  name={`gate.${name}`}
                  type="number"
                  min={0}
                  step="0.1"
                  defaultValue={points(value)}
                />
              </Field>
            ))}
          </div>
        </Section>
        {draft ? (
          <div className="qb:flex">
            <Button type="submit">{t("editor.save")}</Button>
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
  t,
}: Readonly<{
  sample: Sample;
  version: TypeVersion;
  preview: ReactNode;
  update: Action;
  t: DocReaderT;
}>) {
  const type = version.definition;
  return (
    <Card className="qb:mt-5">
      <CardHeader
        title={t("sample.title", { file: sample.fileName })}
        description={t("sample.description")}
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
                  label={t("sample.param", { label: param.label })}
                  htmlFor={id("sample-param", param.key)}
                  hint={param.type === "string-list" ? t("sample.listHint") : undefined}
                >
                  <Input
                    id={id("sample-param", param.key)}
                    name={`params.${param.key}`}
                    defaultValue={Array.isArray(value) ? value.join(", ") : (value ?? "")}
                  />
                </Field>
              );
            })}
            <Field label={t("sample.note")} htmlFor={id("note")}>
              <Input
                id={id("note")}
                name="note"
                defaultValue={sample.note ?? ""}
                placeholder={t("sample.notePlaceholder")}
              />
            </Field>
            <Button type="submit">{t("sample.save")}</Button>
          </form>
          <div className="qb:min-w-0 qb:md:col-span-3">{preview}</div>
        </div>
      </CardBody>
    </Card>
  );
}

function variantLabel(t: DocReaderT, run: TestRun, models: readonly ModelChoice[]): string {
  const purpose = run.purpose === "bench" ? [] : [t("run.version", { version: run.typeVersion })];
  if (!run.variant) return [...purpose, t("run.thisVersion")].join(" · ");
  const { connectionId, connection: connectionName, version, model, options } = run.variant;
  const connection = models.find((c) => c.connectionId === connectionId);
  const named = connection?.connectionName ?? connectionName ?? connectionId;
  return [
    ...(version === undefined ? [] : [t("run.version", { version })]),
    ...(named === undefined ? [] : [named, model ?? t("run.defaultModel")]),
    ...(options === undefined
      ? []
      : Object.entries(options).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)),
  ].join(" · ");
}

/** Rows of a run's result table. Larger runs: the metrics, the comparison and the export. */
const RESULT_ROWS = 100;

function RunCard({
  run,
  label,
  i18n,
  inspectHref,
}: Readonly<{
  run: TestRun;
  label: string;
  i18n: AdminI18n;
  inspectHref: (sampleId: string) => string;
}>) {
  const t = docReaderT(i18n);
  const summary = run.summary;
  const fields = run.results[0]?.fields.map((f) => f.label) ?? [];
  return (
    <Card>
      <CardHeader
        title={label}
        description={formatWhen(i18n, run.createdAt)}
        actions={<StateBadge state={run.state} i18n={i18n} />}
      />
      <CardBody className="qb:space-y-4">
        <div className="qb:grid qb:grid-cols-1 qb:gap-4 qb:sm:grid-cols-2 qb:xl:grid-cols-3">
          <Stat label={t("run.matches")}>
            {summary && summary.checked > 0
              ? t("run.matchesValue", {
                  percent: formatPercent(i18n, summary.accuracy),
                  matched: summary.matched,
                  checked: summary.checked,
                })
              : EMPTY}
          </Stat>
          <Stat label={t("col.cost")}>{formatUsd(i18n, run.costUsd)}</Stat>
          <Stat label={t("run.averageTime")}>
            {summary ? formatMs(i18n, summary.avgLatencyMs) : EMPTY}
          </Stat>
        </div>
        <RunStats run={run} i18n={i18n} />
        {run.error ? <p className="qb:text-sm qb:text-danger-strong">{run.error}</p> : null}
        <ExportLinks run={run} t={t} />
      </CardBody>
      {run.metrics ? <MetricsTables metrics={run.metrics} i18n={i18n} /> : null}
      {run.results.length > 0 ? (
        <Table aria-label={t("run.results", { label })}>
          <thead>
            <tr>
              <Th>{t("col.sample")}</Th>
              {fields.map((name) => (
                <Th key={name}>{name}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.results.slice(0, RESULT_ROWS).map((result) => (
              <Tr key={result.sampleId}>
                <Td>
                  <Link href={inspectHref(result.sampleId)} className={linkClass}>
                    {result.sampleKey ?? result.fileName}
                  </Link>
                  <StatusBadge status={result.status} i18n={i18n} />
                  {result.split ? (
                    <>
                      {" "}
                      <SplitBadge split={result.split} t={t} />
                    </>
                  ) : null}
                  {result.error ? (
                    <p className="qb:text-xs qb:text-danger-strong">{result.error}</p>
                  ) : null}
                </Td>
                {result.fields.map((check) => (
                  <Td key={check.key}>
                    <span className="qb:font-mono qb:text-sm">{check.read ?? EMPTY}</span>{" "}
                    {check.match === true ? <Badge tone="green">{t("run.match")}</Badge> : null}
                    {check.match === false ? (
                      <Badge tone="red">{t("run.expected", { value: check.expected ?? "" })}</Badge>
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
  t,
}: Readonly<{ prefix: string; label: string; models: readonly ModelChoice[]; t: DocReaderT }>) {
  if (models.length > 0) {
    return (
      <Field label={label} htmlFor={id("variant", prefix)}>
        <Select id={id("variant", prefix)} name={`${prefix}.choice`} required>
          <option value="">{t("picker.choose")}</option>
          {models.flatMap((choice) => [
            <option key={choice.connectionId} value={choice.connectionId}>
              {t("picker.default", { connection: choice.connectionName })}
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
      <Field
        label={t("picker.connectionId", { label })}
        htmlFor={id("variant", prefix, "connection")}
      >
        <Input id={id("variant", prefix, "connection")} name={`${prefix}.connectionId`} required />
      </Field>
      <Field label={t("picker.model", { label })} htmlFor={id("variant", prefix, "model")}>
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
  i18n,
  split,
  splitFilter,
  page,
  comparison,
  hasPublished,
  comparable,
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
  i18n: AdminI18n;
  split: SplitVersion | null;
  splitFilter: Split | undefined;
  page: number;
  comparison: { view: RunComparison; a: TestRun; b: TestRun } | null;
  hasPublished: boolean;
  /** Runs to compare: this version's and the published version's baseline. */
  comparable: readonly TestRun[];
}>) {
  const t = docReaderT(i18n);
  const href = (query: Record<string, string>) =>
    `${basePath}/document-types/${encodeURIComponent(version.key)}?${new URLSearchParams({ v: String(version.version), tab: "bench", ...query }).toString()}`;
  const editing = samples.find((sample) => sample.id === sampleParam);
  const selected = runs.find((run) => run.id === runParam) ?? runs[0];
  const group = selected?.compareGroup;
  let shown: TestRun[] = [];
  if (group) shown = runs.filter((run) => run.compareGroup === group);
  else if (selected) shown = [selected];
  const keys = { typeKey: version.key, version: version.version };
  const filtered = splitFilter ? samples.filter((s) => s.split === splitFilter) : samples;
  const inspectHref = (sampleId: string, runId?: string) =>
    `${basePath}/document-types/${encodeURIComponent(version.key)}/samples/${encodeURIComponent(sampleId)}?${new URLSearchParams({ v: String(version.version), ...(runId ? { run: runId } : {}) }).toString()}`;
  const listed = filtered.slice((page - 1) * SAMPLES_PER_PAGE, page * SAMPLES_PER_PAGE);
  const baseline = hasPublished && version.state === "draft";
  return (
    <div className="qb:space-y-4">
      <SplitCard
        version={version}
        split={split}
        unsplit={samples.filter((s) => s.split === null).length}
        action={actions.split}
        i18n={i18n}
      />
      <Card>
        <CardHeader title={t("bench.samples")} description={t("bench.samplesDescription")} />
        <CardBody>
          <SampleFilter samples={samples} current={splitFilter} page={page} href={href} t={t} />
        </CardBody>
        {listed.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>{t("col.file")}</Th>
                <Th>{t("col.split")}</Th>
                <Th>{t("col.group")}</Th>
                <Th>{t("col.expected")}</Th>
                <Th>{t("col.note")}</Th>
                <Th>{t("col.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {listed.map((sample) => (
                <Tr key={sample.id}>
                  <Td>
                    <Link href={href({ sample: sample.id })} className={linkClass}>
                      {sample.key ?? sample.fileName}
                    </Link>
                  </Td>
                  <Td>
                    <SplitBadge split={sample.split} t={t} />
                  </Td>
                  <Td>{sample.group ?? ""}</Td>
                  <Td>
                    {t("bench.filled", {
                      filled: Object.keys(sample.expected).length,
                      total: version.definition.fields.length,
                    })}
                  </Td>
                  <Td>{sample.note ?? ""}</Td>
                  <Td>
                    <Link href={inspectHref(sample.id)} className={linkClass}>
                      {t("bench.inspect")}
                    </Link>
                    <form action={actions.removeSample}>
                      <Hidden values={{ ...keys, sampleId: sample.id }} />
                      <Button
                        type="submit"
                        size="sm"
                        variant="ghost"
                        aria-label={t("bench.removeSample", { file: sample.fileName })}
                      >
                        {t("bench.remove")}
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
              label={t("bench.addSamples")}
              htmlFor={id("samples")}
              hint={t("bench.addSamplesHint")}
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
                {t("bench.upload")}
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
          t={t}
        />
      ) : null}
      <Card>
        <CardHeader title={t("bench.test")} description={t("bench.testDescription")} />
        <CardBody className="qb:space-y-4">
          <form action={actions.startTest} className="qb:space-y-3">
            <Hidden values={{ ...keys, mode: "version" }} />
            <RunOptions split={split} t={t} baseline={baseline} />
            <Button type="submit" disabled={samples.length === 0}>
              {split ? t("bench.runSplits") : t("bench.testRun", { count: samples.length })}
            </Button>
          </form>
          <form
            action={actions.startTest}
            className="qb:space-y-3 qb:border-t qb:border-line-soft qb:pt-4"
          >
            <Hidden values={{ ...keys, mode: "compare" }} />
            <p className="qb:text-sm qb:text-fg-muted">{t("bench.compareText")}</p>
            <RunOptions split={split} t={t} baseline={false} />
            <div className="qb:flex qb:flex-wrap qb:items-end qb:gap-4">
              <ModelPicker prefix="a" label={t("bench.modelA")} models={models} t={t} />
              <ModelPicker prefix="b" label={t("bench.modelB")} models={models} t={t} />
              <Button type="submit" variant="secondary" disabled={samples.length === 0}>
                {t("bench.compare")}
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
            <RunCard
              key={run.id}
              run={run}
              label={variantLabel(t, run, models)}
              i18n={i18n}
              inspectHref={(sampleId) => inspectHref(sampleId, run.id)}
            />
          ))}
        </div>
      ) : null}
      {comparison ? (
        <ComparisonView
          comparison={comparison.view}
          labelA={`${formatWhen(i18n, comparison.a.createdAt)} · ${variantLabel(t, comparison.a, models)}`}
          labelB={`${formatWhen(i18n, comparison.b.createdAt)} · ${variantLabel(t, comparison.b, models)}`}
          sampleHref={(sampleId) => inspectHref(sampleId, comparison.b.id)}
          i18n={i18n}
        />
      ) : null}
      {comparable.length > 1 ? (
        <Card>
          <CardHeader title={t("compare.title")} />
          <CardBody>
            <ComparePicker
              runs={comparable}
              label={(run) => variantLabel(t, run, models)}
              hidden={{ v: String(version.version), tab: "bench" }}
              reference={comparison?.a.id}
              candidate={comparison?.b.id}
              t={t}
              i18n={i18n}
            />
          </CardBody>
        </Card>
      ) : null}
      {runs.length > 1 ? (
        <Card>
          <CardHeader title={t("bench.earlier")} />
          <Table>
            <thead>
              <tr>
                <Th>{t("col.when")}</Th>
                <Th>{t("col.what")}</Th>
                <Th>{t("col.state")}</Th>
                <Th>{t("col.matches")}</Th>
                <Th>{t("col.cost")}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Tr key={run.id}>
                  <Td>
                    <Link href={href({ run: run.id })} className={linkClass}>
                      {formatWhen(i18n, run.createdAt)}
                    </Link>
                  </Td>
                  <Td>
                    {run.compareGroup
                      ? t("run.comparison", { label: variantLabel(t, run, models) })
                      : variantLabel(t, run, models)}
                  </Td>
                  <Td>
                    <StateBadge state={run.state} i18n={i18n} />
                  </Td>
                  <Td>{formatPercent(i18n, run.summary?.accuracy ?? null)}</Td>
                  <Td>{formatUsd(i18n, run.costUsd)}</Td>
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
  t: DocReaderT,
): Promise<ReactNode> {
  if (!sample) return null;
  if ((sample.size ?? 0) > PREVIEW_MAX_BYTES)
    return <p className="qb:text-sm qb:text-fg-muted">{t("preview.tooLarge")}</p>;
  try {
    const file = await sampleFile(qb, ctx, sample.id);
    return <FilePreview base64={toBase64(file.bytes)} mime={file.mime} name={file.fileName} />;
  } catch {
    return <p className="qb:text-sm qb:text-danger-strong">{t("studio.sampleGone")}</p>;
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

function VersionActions({
  version,
  hasDraft,
  publishable,
  actions,
  t,
}: Readonly<{
  version: TypeVersion;
  hasDraft: boolean;
  publishable: boolean;
  actions: Actions;
  t: DocReaderT;
}>) {
  const keys = { typeKey: version.key, version: version.version };
  return (
    <>
      {version.state === "draft" ? (
        <>
          <form action={actions.publish}>
            <Hidden values={keys} />
            <Button
              type="submit"
              disabled={!publishable}
              title={publishable ? undefined : t("studio.testFirst")}
            >
              {t("studio.publish", { version: version.version })}
            </Button>
          </form>
          <form action={actions.deleteDraft}>
            <Hidden values={keys} />
            <Button type="submit" variant="danger">
              {t("studio.deleteDraft")}
            </Button>
          </form>
        </>
      ) : null}
      {hasDraft ? null : (
        <form action={actions.createDraft}>
          <Hidden values={{ typeKey: version.key, from: version.version }} />
          <Button type="submit" variant="secondary">
            {t("studio.newDraft", { version: version.version })}
          </Button>
        </form>
      )}
    </>
  );
}

/** Before a split: a line when the draft needs a test. After: the publish check. */
function PublishHint({ check, i18n }: Readonly<{ check: PublishCheck | null; i18n: AdminI18n }>) {
  if (!check) return null;
  if (check.splitVersion === null) {
    return check.ok ? null : (
      <p className="qb:mb-3 qb:text-sm qb:text-fg-muted">{docReaderT(i18n)("studio.needsTest")}</p>
    );
  }
  return (
    <div className="qb:mb-3">
      <PublishCheckNotice check={check} i18n={i18n} />
    </div>
  );
}

/** A 1-based page number from the URL. */
function pageOf(value: string | undefined): number {
  const n = Math.floor(Number(value ?? "1"));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** The publish check, the history and the chosen comparison of the studio page. */
async function benchData(
  qb: Quickben,
  ctx: RequestContext,
  input: {
    version: TypeVersion;
    runs: readonly TestRun[];
    published: readonly VersionSummary[];
    bench: boolean;
    ref: string | undefined;
    cand: string | undefined;
  },
) {
  const { version, runs } = input;
  const check =
    version.state === "draft" ? await publishCheck(qb, ctx, version.key, version.version) : null;
  const history = input.bench
    ? await Promise.all(input.published.map((v) => getVersion(qb, ctx, version.key, v.version)))
    : [];
  // The publish check compares with the published version's runs, so offer those too.
  const baseline = check?.baseline;
  const comparable =
    baseline && !runs.some((run) => run.id === baseline.id) ? [...runs, baseline] : [...runs];
  const a = comparable.find((run) => run.id === input.ref);
  const b = comparable.find((run) => run.id === input.cand);
  const comparison =
    input.bench && a && b && a.id !== b.id
      ? { view: await compareTestRuns(qb, ctx, a.id, b.id), a, b }
      : null;
  return { check, history, comparable, comparison };
}

/** One type: its versions, the editor of the chosen one and the test bench. */
export async function StudioPage({
  config,
  adminKey,
  basePath,
  typeKey,
  searchParams,
  i18n,
}: Readonly<{
  config: QuickbenConfig;
  adminKey: string;
  basePath: string;
  typeKey: string;
  searchParams: SearchParams;
  i18n: AdminI18n;
}>) {
  const t = docReaderT(i18n);
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
        <Heading title={t("studio.notFound")} />
        <Notice>
          {t("studio.notFoundBody", { key: typeKey })}{" "}
          <Link href={`${basePath}/document-types`} className={linkClass}>
            {t("studio.backToTypes")}
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
  const [version, runs, samples, models, split] = await Promise.all([
    getVersion(qb, ctx, typeKey, number),
    listTestRuns(qb, ctx, typeKey, number, 50),
    listSamples(qb, ctx, typeKey),
    modelChoices(state),
    currentSplit(qb, ctx, typeKey),
  ]);
  const draft = versions.find((v) => v.state === "draft");
  const published = versions.filter((v) => v.state === "published");
  const { check, history, comparable, comparison } = await benchData(qb, ctx, {
    version,
    runs,
    published,
    bench: tab === "bench",
    ref: first(searchParams.ref),
    cand: first(searchParams.cand),
  });
  const publishable = check?.ok === true;
  const splitParam = first(searchParams.split);
  const page = pageOf(first(searchParams.page));
  const tabHref = (name: string) =>
    `${basePath}/document-types/${encodeURIComponent(typeKey)}?v=${String(number)}&tab=${name}`;
  const sampleParam = first(searchParams.sample);

  return (
    <>
      <p className="qb:mb-3 qb:text-sm">
        <Link href={`${basePath}/document-types`} className={linkClass}>
          {t("studio.back")}
        </Link>
      </p>
      <Heading
        title={version.label}
        description={
          <>
            <span className="qb:font-mono">{typeKey}</span> ·{" "}
            {t("version.short", { version: version.version })} ·{" "}
            <StateBadge state={version.state} i18n={i18n} />
            {version.publishedAt
              ? ` · ${t("studio.publishedAt", { when: formatWhen(i18n, version.publishedAt) })}`
              : ""}
            {version.state === "draft" && version.builtin ? ` · ${t("studio.codeDraft")}` : ""}
          </>
        }
        actions={
          <VersionActions
            version={version}
            hasDraft={draft !== undefined}
            publishable={publishable}
            actions={actions}
            t={t}
          />
        }
      />
      <nav aria-label={t("studio.versions")} className="qb:mb-3 qb:flex qb:flex-wrap qb:gap-2">
        {versions.map((v) => (
          <ButtonLink
            key={v.version}
            href={`${basePath}/document-types/${encodeURIComponent(typeKey)}?v=${String(v.version)}&tab=${tab}`}
            size="sm"
            variant={v.version === number ? "primary" : "ghost"}
            aria-current={v.version === number ? "page" : undefined}
          >
            {t("version.chip", { version: v.version, state: stateLabel(t, v.state) })}
          </ButtonLink>
        ))}
      </nav>
      <nav
        aria-label={t("studio.sections")}
        className="qb:mb-6 qb:flex qb:gap-2 qb:border-b qb:border-line qb:pb-4"
      >
        <ButtonLink
          href={tabHref("definition")}
          size="sm"
          variant={tab === "definition" ? "secondary" : "ghost"}
          aria-current={tab === "definition" ? "page" : undefined}
        >
          {t("studio.definition")}
        </ButtonLink>
        <ButtonLink
          href={tabHref("bench")}
          size="sm"
          variant={tab === "bench" ? "secondary" : "ghost"}
          aria-current={tab === "bench" ? "page" : undefined}
        >
          {t("studio.bench", { count: samples.length })}
        </ButtonLink>
      </nav>
      <PublishHint check={check} i18n={i18n} />
      {tab === "definition" ? (
        <Editor
          version={version}
          state={state}
          models={models}
          samples={samples}
          save={actions.saveDraft}
          t={t}
        />
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
            t,
          )}
          actions={actions}
          i18n={i18n}
          split={split}
          splitFilter={isSplit(splitParam) ? splitParam : undefined}
          page={page}
          comparison={comparison}
          hasPublished={published.length > 0}
          comparable={comparable}
        />
      )}
      {tab === "bench" ? (
        <div className="qb:mt-5">
          <HistoryCard versions={history} i18n={i18n} />
        </div>
      ) : null}
    </>
  );
}
