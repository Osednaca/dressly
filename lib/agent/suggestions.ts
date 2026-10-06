import { lookItems } from "@/lib/catalog/query";
import type { Suggestion } from "@/lib/api-types";
import type { StylingSession } from "@/lib/types";

/**
 * Suggested next messages.
 *
 * Deterministic and state-aware: the chips change as the outfit develops, so the
 * shopper always sees moves the agent can actually act on. They are shortcuts for
 * natural language, not a menu of hidden commands.
 */
export function suggestionsFor(session: StylingSession): Suggestion[] {
  const worn = lookItems(session.currentLook);
  const suggestions: Suggestion[] = [];
  const push = (label: string, message: string, primary = false) => {
    if (!suggestions.some((entry) => entry.message === message)) {
      suggestions.push({ label, message, primary });
    }
  };

  if (session.looks.length === 0) {
    push(
      "Rooftop dinner",
      "I have a rooftop dinner tonight. Something elegant but not too formal.",
      true,
    );
    push("Smart casual date", "I'm going on a smart casual date.");
    push("Office day", "I need something for a day at the office.");
    push("Weekend trip", "I'm packing for a relaxed weekend trip.");
    return suggestions.slice(0, 4);
  }

  if (session.avoidedStyles.includes("formal") || session.avoidedStyles.includes("business")) {
    push("Slightly dressier", "Actually, make it a touch more formal.");
  } else {
    push("Less formal", "Too formal — make it more relaxed.");
  }

  if (!session.currentLook.outer) push("Add a jacket", "That's better. Add a jacket.", true);
  if (session.currentLook.shoes) push("Swap the shoes", "Try different shoes instead.");
  else push("Add shoes", "Add some shoes to finish the look.");

  push("Show another option", "Show me another option.");
  if (worn.length >= 2) push("Finish the look", "This is it — finish the look.", true);
  if (worn.length >= 1) push("I love it", "I love it.");

  return suggestions.slice(0, 6);
}
