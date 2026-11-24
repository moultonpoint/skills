# Repository rules

Put each skill in `skills/<bucket>/<name>/SKILL.md`. Use the folder name for its frontmatter `name` and describe the job in `description`. Keep helper scripts and agent metadata beside the skill.

`content` holds shipped content skills. List each shipped skill in its bucket README, the root README and the `skills` array in `.claude-plugin/plugin.json`. Keep public betas in `skills/in-progress/` until they ship.

Use plain punctuation. Avoid em dashes in Markdown. Revisit Changesets and a root `package.json` when the collection has more skills.

Run these checks from the repository root after edits:

```sh
node scripts/check-frontmatter.mjs
node skills/content/analyze/scripts/selfcheck.mjs
claude plugin validate . --strict
```
