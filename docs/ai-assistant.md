# Optional general-purpose energy assistant

Status: a provider-neutral capability/proposal contract and instruction template are implemented. No AI provider is connected, no model request is made, and no AI schedule or setting is activated.

## Scope

The assistant should understand varied requests about the integration: explain energy use, compare tariffs and forecasts, create or revise schedules, select supported modes, adjust user limits, coordinate EV charging, inspect module performance, and choose dashboard cards/charts. It is not a fixed collection of charging prompts. New real capabilities extend a runtime catalogue rather than requiring a new agent architecture.

Recommended flow: natural language → relevant installation context and capability catalogue → structured proposal or focused clarification → integration validation and readable change preview → owner activation → deterministic local scheduler and controller. AI interprets and explains; the accepted strategy runs without a new model call every control tick. Existing manual priority and device protections apply.

`core/agent.py` provides an extensible catalogue with argument validation, capability availability, settings-change classification and a bounded multi-step proposal review. It deliberately has no executor or network client. Runtime registration against real integration adapters remains to be implemented; registering a catalogue entry does not grant hardware permission.

## Prompt and tool contract

`prompts/energy-agent.md` is a versioned instruction template to be assembled with relevant context by each provider adapter. An `AGENTS.md` filename alone does not make an arbitrary AI read it or enforce rules. Some providers use system/developer messages, some native agent instructions. The adapter must supply the content using the provider's supported mechanism.

The runtime validates every argument against code-owned schemas and checks permissions, fresh telemetry, transport capability, export constraints, conflicting schedules and control ownership. The model cannot write arbitrary Modbus registers, HA YAML, installer settings or device services. Human-readable reasoning is not executable configuration.

A request can span several capabilities. Unsupported or ambiguous actions return blockers/questions, not fabricated success. A future delegated automation mode needs explicit bounds and revocation. Routine read/explain requests do not require change approval.

## Subscription and account options researched

These are provider paths to evaluate, not implemented login buttons or a claim that every chat subscription includes third-party API access:

| Path | Evidence and remaining work |
| --- | --- |
| Existing HA conversation agent | Reuse an owner-selected agent where suitable, without changing the household's default pipeline. The built-in OpenAI and Gemini integrations use API keys; account costs/quotas remain with the selected integration. An unconstrained general HA agent is not automatically a safe energy-policy compiler. |
| OpenAI / Codex subscription | Official Codex authentication supports ChatGPT subscription sign-in, and the Codex SDK/app-server supports local programmatic clients. A separately authenticated local bridge is a candidate. Validate supported use, headless operation, permissions, quotas and deployment before offering it in HA. Do not extract browser/Codex tokens into integration storage. |
| Gemini CLI account login | Official CLI docs support Google account login for individual accounts including Google AI Pro/Ultra; headless use can reuse an existing authenticated CLI session. A local bridge is a candidate, with terms, quotas and deployment still to validate. This is different from a Gemini API key. |
| Claude | Claude Code supports own-account subscription sign-in, but Anthropic distinguishes hosting an unmodified end-user-authenticated CLI from offering Claude.ai login or routing subscription credentials through another application's agent. Do not implement a generic Claude subscription OAuth proxy. A native owner-run tool route needs a documented permitted design; the ordinary third-party API route uses the owner's API/provider credentials. |
| Local models | An owner-configured local HA agent/endpoint may provide an optional no-cloud path. Capability and structured-output acceptance still apply. |

AI is optional and off by default. No paid inference fallback is enabled. A user who explicitly chooses a metered provider needs clear cost controls and must provide their own authorized credentials through its supported flow. Keep provider account authentication with that provider or bridge; integration diagnostics must never expose credentials or household prompts.

## Illustrative request, not an installed strategy

An owner might ask for night charging, an overnight-crossing discharge window and solar export only above a chosen SOC. This requires separate charge/discharge schedules, a solar-sale threshold distinct from the battery reserve, a defined fallback below the threshold, export permission and a verified way to route solar to export while a battery supplies the house. Not every plant/API can provide that routing.

The example discussed during design uses 02:00–05:00 charging, 08:00–01:00 the next morning discharging and solar sale only while SOC is strictly above 75%. It is one example among many, not a hardcoded rule or an activation request. Falling to 75% must stop the sale policy; the battery discharge reserve is separately configured. Actual fallback, hysteresis, power limits and final policy would be clarified in a real request.

## Official sources

- [Codex authentication](https://learn.chatgpt.com/docs/auth) and [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/)
- [Claude Code authentication](https://code.claude.com/docs/en/iam) and [credential/product boundaries](https://code.claude.com/docs/en/legal-and-compliance)
- [HA OpenAI](https://www.home-assistant.io/integrations/openai_conversation/), [HA Gemini](https://www.home-assistant.io/integrations/google_generative_ai_conversation/) and [HA conversation API](https://contributors.home-assistant.io/core/internals/conversation-api/)
