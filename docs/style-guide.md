Repository Style Guide
======================

This guide defines reusable naming, formatting, and documentation defaults for repositories under `C:\Repositories`. A repository may extend or override these rules in its own `docs/style-guide.md`. Existing local style takes precedence unless a deliberate migration is part of the work.


Core Principles
---------------

- Optimize for clarity, maintainability, and predictable behavior.
- Keep changes narrow and consistent with nearby code.
- Prefer descriptive names over abbreviations.
- Avoid abstractions until they remove real duplication or isolate an important boundary.
- Treat generated, vendored, and third-party content as read-only unless the repository explicitly owns it.
- Do not reformat or rename unrelated code while implementing a focused change.
- Use plain ASCII text unless the content genuinely requires broader Unicode characters.


Repository Layout
-----------------

- Use conventional uppercase names for special root documents such as `README.md`, `AGENTS.md`, `LICENSE`, and `CHANGELOG.md`.
- Use lowercase names for top-level organizational directories such as `src`, `tests`, `docs`, `tools`, `assets`, and `samples`.
- Use lower-kebab-case for repository-owned documentation and scripts unless the language or consuming tool has a stronger convention.
- Keep source, tests, generated output, and temporary files in clearly separate locations.
- Keep temporary agent output under `.codex-temp` when practical.
- Do not commit build output, caches, user settings, secrets, or temporary files unless repository policy explicitly requires them.


Naming
------

- Follow the established convention of the language, framework, and surrounding code.
- Name types and modules after their responsibilities rather than implementation mechanisms.
- Name Boolean values affirmatively where practical, such as `isEnabled`, `hasOutput`, or `canRetry`.
- Use verbs for operations and nouns for data or services.
- Use `Get` for reads, `Set` for direct mutations, `Try` for expected failure, and `Create` for construction when those distinctions fit the language.
- Reserve `Manager`, `Helper`, and `Utility` for cases with a clear, narrow responsibility; prefer domain-specific names.
- Avoid embedding version numbers, technology names, or temporary implementation details in durable public names.


Formatting
----------

- Prefer the repository's formatter and editor configuration when present.
- Do not hand-format generated files.
- Keep functions and classes focused enough that their purpose can be understood without extensive comments.
- Use comments to explain intent, constraints, and surprising decisions rather than restating code.
- Keep related declarations together and separate unrelated concepts with whitespace.
- Use braces, trailing commas, quoting, and line endings consistently with the local project.
- Avoid decorative section banners in ordinary source files unless the file is large enough that navigation materially benefits.


Markdown
--------

- Use one Setext level-one heading for the document title.
- Use Setext level-two headings for major sections.
- Use ATX headings only when a third heading level is genuinely required.
- Leave one blank line between a heading and its content and two blank lines before later major sections.
- Prefer concise prose followed by short, one-level lists.
- Use tables only when comparing repeated fields or options.
- Use fenced code blocks with a language identifier when one applies.
- Use relative links between repository documents so they continue to work on Git hosting sites.
- Keep public-facing README text focused on purpose, installation, usage, and contribution paths; move detailed engineering rationale into `docs`.


Configuration And Data
----------------------

- Use stable, descriptive keys and document units, valid ranges, and defaults.
- Treat persisted names and serialized fields as compatibility contracts.
- Do not rename or reinterpret persisted values without an explicit migration or reset decision.
- Validate external input at system boundaries and provide actionable errors.
- Keep example configuration free of credentials, machine-specific paths, and personal data.
- Prefer deterministic serialization so diffs remain reviewable.


Errors And Logging
------------------

- Fail clearly at the boundary where an error can be explained or recovered.
- Preserve the original exception or diagnostic context when wrapping failures.
- Write user-facing errors in plain language and include a practical next action.
- Keep logs structured and useful for diagnosis without exposing secrets or unnecessary personal data.
- Do not use exceptions for ordinary control flow.
- Distinguish cancellation from failure.


Tests
-----

- Test externally meaningful behavior and important edge cases rather than private implementation details.
- Add regression coverage with bug fixes when a focused automated test is practical.
- Keep tests deterministic and independent of execution order.
- Name tests so the scenario and expected result are clear.
- Isolate filesystem, process, network, clock, and random behavior behind controllable boundaries when it improves reliability.
- Keep fixtures small, intentional, and legally safe to redistribute.


Documentation
-------------

- Record durable product and architecture decisions in repository documentation rather than chat history.
- Update documentation in the same change when behavior, setup, public configuration, or supported workflows change.
- State whether proposed behavior is implemented, planned, experimental, or rejected.
- Prefer examples that users can run or adapt directly.
- Keep commit policy in `docs/commit-style.md` and repository-specific code conventions in `docs/style-guide.md`.


Automation
----------

- Prefer documented repository commands over ad hoc command sequences.
- Keep build and test scripts non-interactive where practical.
- Make automation fail with a nonzero exit code and an actionable diagnostic.
- Avoid scripts that silently overwrite source inputs or user files.
- Pin tool versions when reproducibility matters, and document how to update them.
