import type {
  PromptComponent,
  PromptComponentCategory,
  PromptEnvelope
} from "./types.js";
import { PROMPT_COMPONENT_CATEGORY_ORDER } from "./types.js";

export const PROMPT_COMPONENT_ORDER =
  PROMPT_COMPONENT_CATEGORY_ORDER satisfies readonly PromptComponentCategory[];

export function createPromptEnvelope(
  components: readonly PromptComponent[]
): PromptEnvelope {
  const nonEmpty = components.filter((component) => component.text.length > 0);
  return {
    rendered: nonEmpty.map((component) => component.text).join(""),
    components: nonEmpty.map((component) => ({ ...component }))
  };
}

export function promptEnvelopeFromSections(
  rendered: string,
  boundaries: readonly {
    index: number;
    category: PromptComponent["category"];
  }[]
): PromptEnvelope {
  const ordered = [...boundaries]
    .filter(
      (boundary) => boundary.index >= 0 && boundary.index <= rendered.length
    )
    .sort((left, right) => left.index - right.index);
  if (ordered[0]?.index !== 0) {
    ordered.unshift({ index: 0, category: "phase_instructions" });
  }
  const components: PromptComponent[] = [];
  for (const [position, boundary] of ordered.entries()) {
    const next = ordered[position + 1]?.index ?? rendered.length;
    if (next > boundary.index) {
      components.push({
        category: boundary.category,
        text: rendered.slice(boundary.index, next)
      });
    }
  }
  return createPromptEnvelope(components);
}

export function promptText(prompt: string | PromptEnvelope): string {
  return typeof prompt === "string" ? prompt : prompt.rendered;
}

export function promptEnvelope(
  prompt: string | PromptEnvelope
): PromptEnvelope {
  return typeof prompt === "string"
    ? createPromptEnvelope([{ category: "phase_instructions", text: prompt }])
    : prompt;
}

export function appendPromptComponent(
  prompt: string | PromptEnvelope,
  category: PromptComponent["category"],
  text: string
): PromptEnvelope {
  const base = promptEnvelope(prompt);
  return createPromptEnvelope([...base.components, { category, text }]);
}
