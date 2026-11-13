import type { TemplateContent, TemplateIssue } from "../content";
import type { CatalogVariable } from "../kinds";

/** What the workspace can do with the lazily loaded editor. */
export interface EditorApi {
  getContent(): TemplateContent;
  setContent(content: TemplateContent): void;
  showIssues(issues: readonly TemplateIssue[]): void;
  focusIssue(issue: TemplateIssue): void;
}

/** Props of the TipTap editor. */
export interface TemplateEditorProps {
  catalog: readonly CatalogVariable[];
  initialContent: TemplateContent;
  editable: boolean;
  onChange: (content: TemplateContent) => void;
  onReady: (api: EditorApi) => void;
}
