#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function loadRuleFile(rel) {
  try {
    const p = path.join(process.cwd(), rel);
    if (!fs.existsSync(p)) return {};
    const txt = fs.readFileSync(p, 'utf8');
    // strip leading --- frontmatter if present
    const m = txt.match(/^---([\s\S]*?)---/);
    if (m) {
      return yaml.load(m[1]) || {};
    }
    return {};
  } catch (e) {
    console.error('failed to load rule file', rel, e);
    return {};
  }
}

function decideBranch(changedFiles = []) {
  // Basic decision rules per allrule
  const all = loadRuleFile('.cursor/rules/allrule.mdc');
  const proj = loadRuleFile('.cursor/rules/projectrule.mdc');

  // If file(s) under lambda/ changed => lambda branch
  if (changedFiles.some(f => f.startsWith('lambda/'))) return 'lambda';
  // If only docs or README => staging
  if (changedFiles.every(f => f.match(/\.(md|txt)$/))) return 'staging';
  // Default: staging
  return 'staging';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const files = args.length ? args : ['.'];
  console.log('decideBranch ->', decideBranch(files));
}

module.exports = { loadRuleFile, decideBranch };


