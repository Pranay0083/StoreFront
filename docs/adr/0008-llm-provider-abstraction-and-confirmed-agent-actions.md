# ADR 0008: LLM provider abstraction and confirm-before-write agent actions

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

The assistant was hard-wired to Groq, with tool definitions duplicated between the chat agent and the MCP server, and a copy-pasted retry on HTTP 429. Letting a model change carts or cancel orders creates prompt-injection risk: review text is user-generated, and it flows into the model's context.

## Decision

- **Tools as Commands.** Each tool is a class with a zod schema, an access level, channels and `requiresConfirmation`, held in one `ToolRegistry` that generates both the chat tool specs and the MCP server.
- **Provider abstraction.** An `LLMProvider` interface with Groq and Anthropic adapters, chosen by `LLMProviderFactory` and decorated with retry and a circuit breaker.
- **Confirmed writes.** Write tools (`add_to_cart`, `cancel_order`, `request_refund`) only create a pending action bound to the signed-in customer; an authenticated, CSRF-protected confirm call executes it through the normal services.
- **Defence in depth.** Tool results and customer content are delimited and neutralised, and a deterministic `ToolUsePolicy` only lets a write tool through when the customer's own message asked for it.

## Consequences

- **Positive:** providers can be swapped by configuration, MCP and chat cannot drift, and a successful injection can at most propose an action the customer has to approve.
- **Positive:** a scripted provider makes the eval suite deterministic.
- **Negative:** an adapter has to be maintained per vendor as their APIs change, and the confirmation step adds a click.

## Alternatives considered

- **A vendor SDK directly in the service:** less code, but lock-in, and it is hard to test.
- **Letting the model execute writes directly with a system-prompt warning:** relies on the model resisting injection, which is not a security boundary.
