# Releasing

Publish releases only from `2wenty2wo/mushroom-meshcore-card`. The `jpettitt/meshcore-card` repository and the `upstream` remote are read-only references.

## Prepare the release

1. Update `package.json` and `package-lock.json` to the same version.
2. Label each user-facing pull request with the most relevant release label: `breaking-change`, `enhancement`, `bug`, `documentation`, `translation`, `maintenance`, or `dependencies`. Use `skip-changelog` for internal-only changes that should not appear in HACS update notes.
3. Run `npm ci`, `npm run docs:build`, `npm run typecheck`, `npm run check-translations`, `npm test`, `npm run build`, `npm run test:render`, and `git diff --check`.
4. Use a full SemVer tag that exactly matches both package files, such as `v0.16.0` or `v0.16.0-beta.1`.

## AI-authored pull requests

Repository agents are directed here from `AGENTS.md`. An agent opening or updating a pull request should:

1. Verify the base repository is exactly `2wenty2wo/mushroom-meshcore-card`.
2. Write a title and summary around the user-visible outcome, plus a concise verification section.
3. Apply the single best release label. Use `skip-changelog` instead when the change is internal-only.
4. State the required label in its handoff if its GitHub tooling cannot apply it.
5. Never infer permission to bump a version, push a tag, or publish a release from an ordinary implementation request.

## Curated draft flow

Before pushing the tag, create a GitHub draft release for the intended tag and target commit:

1. Select or enter the full version tag.
2. Use GitHub's **Generate release notes** button.
3. Set the title to `vX.Y.Z — Short user-facing outcome`.
4. Add a short curated summary above the generated categories, then save the draft.
5. Create and push the exact tag on the prepared commit.

Use this summary shape:

```markdown
<One or two sentences explaining the user-visible result.>

## Highlights

- <Most important improvement>
- <Second improvement>

## Before updating

- <Required action, compatibility note, or "No special steps.">
```

The tag workflow preserves the draft's title and body, replaces the `mushroom-meshcore-card.js` asset, verifies it, and publishes only after the release job's test and asset checks pass. The separate HACS validation workflow checks pushes, pull requests, a daily schedule, and manual runs.

## Direct-tag fallback and reruns

If no release exists when a valid tag is pushed, the workflow creates a draft with GitHub-generated categorized notes. Generated notes are seeded only once. A rerun reuses the existing draft or published release, preserves its title and body, and replaces the same asset without appending duplicate notes.

Stable versions use GitHub's normal Latest selection. A SemVer prerelease suffix marks the release as a prerelease, which cannot become Latest.

## Images and HACS

Keep the logo in the deliberately minimal rendered README instead of repeating it in every release body. Detailed screenshots and usage guidance belong in the VitePress documentation. HACS can combine multiple skipped release descriptions in one update, so release notes should stay compact.

When a release genuinely benefits from a screenshot, use an absolute URL pinned to that release tag, never `main`:

```markdown
![Main card](https://raw.githubusercontent.com/2wenty2wo/mushroom-meshcore-card/vX.Y.Z/screenshots/main-card.png)
```

Repository-relative screenshot paths remain appropriate for repository Markdown, while public usage pages should link through the VitePress site. The generic Dashboard icon in HACS list and update entities is controlled by HACS; the rendered README remains the compact branded installation surface.
