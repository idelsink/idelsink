#!/usr/bin/env node

require('dotenv').config();
const _ = require('lodash');
const {hideBin} = require('yargs/helpers');
const fs = require('fs');
const path = require("path");
const yargs = require('yargs/yargs');
const emojiRegex = require("emoji-regex");

const argv = yargs(hideBin(process.argv))
  .env('ALLOWED_REACTIONS')
  .usage('Usage: $0 [options]')
  .option('input', {
    describe: 'Strings that contain emojis',
    default: ['👍'],
    type: 'array',
  })
  .option('output', {
    describe: 'Output location of JSON file with allowed reactions',
    default: 'allowed-reactions.json',
    type: 'string'
  })
  .demandOption([
  ])
  .argv;

async function main() {
  console.log('Allowed reactions!');

  const inputString = _.concat(argv.input).join('');
  const regexp = emojiRegex();
  const allowedReactions = Array.from(inputString.matchAll(regexp), m => m[0]);

  console.info('Allowed reactions', allowedReactions);

  await fs.promises.mkdir(path.resolve(path.dirname(argv.output)), { recursive: true });
  await fs.promises.writeFile(
    path.resolve(argv.output),
    JSON.stringify(allowedReactions, null, 2),
  );
  console.log(`Generated allowed reactions file to ${argv.output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
