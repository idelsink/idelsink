#!/usr/bin/env node

require('dotenv').config();
const _ = require('lodash');
const { createTokenAuth } = require("@octokit/auth-token");
const { Octokit } = require("@octokit/rest");
const {hideBin} = require('yargs/helpers');
const fs = require('fs');
const path = require("path");
const yargs = require('yargs/yargs');
const emojiRegex = require("emoji-regex");

const argv = yargs(hideBin(process.argv))
  .env('REACTIONS')
  .usage('Usage: $0 [options]')
  .option('allowedReactions', {
    describe: 'Allowed reactions',
    default: ['👍'],
    type: 'array',
    coerce: (input) => {
      const inputString = _.concat(input).join('');
      const regexp = emojiRegex();
      const allowedReactions = Array.from(inputString.matchAll(regexp), m => m[0]);
      return allowedReactions;
    },
  })
  .option('githubRepository', {
    describe: 'GitHub repository',
    default: process.env.GITHUB_REPOSITORY
  })
  .option('githubRepositoryOwner', {
    describe: 'GitHub repository owner',
    default: process.env.GITHUB_REPOSITORY_OWNER
  })
  .option('githubToken', {
    describe: 'GitHub token for authentication',
    default: process.env.GITHUB_TOKEN
  })
  .option('additionalIssueLabel', {
    describe: 'Additional issue label to filter on',
    default: [],
    type: 'array',
  })
  .option('output', {
    describe: 'Output location of JSON file with reactions',
    default: 'reactions.json',
    type: 'string'
  })
  .option('reactionId', {
    describe: 'The reaction identifier',
    default: '',
    type: 'string',
  })
  .demandOption([
    'githubRepository',
    'githubRepositoryOwner',
    'githubToken',
    'reactionId',
  ])
  .argv;

async function main() {
  console.log('Reactions!');

  const auth = createTokenAuth(argv.githubToken);
  const authentication = await auth();
  const octokit = new Octokit({
    auth: authentication.token
  });

  // Create labels
  const labels = [
    // Colors: https://material.io/archive/guidelines/style/color.html#color-color-palette
    {
      name: 'type: reaction',
      color: 'FFEE58', // Yellow: 400
      description: 'Reaction to something'
    },
    {
      name: 'reaction:state: valid',
      color: '66BB6A', // Green: 400
      description: 'Valid reaction'
    },
    {
      name: 'reaction:state: invalid',
      color: 'EF5350', // Red: 400
      description: 'Invalid reaction'
    },
    ..._.map(argv.additionalIssueLabel, label => ({name: label})),
  ];
  for(label of labels) {
    try {
      await octokit.rest.issues.getLabel({
        owner: argv.githubRepositoryOwner,
        repo: argv.githubRepository,
        name: label.name,
      });
    } catch (e) {
      if (e.name === 'HttpError' && e.status === 404) {
        await octokit.rest.issues.createLabel({
          owner: argv.githubRepositoryOwner,
          repo: argv.githubRepository,
          name: label.name,
          color: label.color,
          description: label.description,
        });
      } else {
        throw (e);
      }
    }
  }

  const openIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: argv.githubRepositoryOwner,
    repo: argv.githubRepository,
    state: 'open',
    labels: [
      'type: reaction',
    ],
  });
  for (issue of openIssues) {
    if (!_.includes(argv.allowedReactions, issue.title)) {
      octokit.rest.issues.update({
        owner: argv.githubRepositoryOwner,
        repo: argv.githubRepository,
        issue_number: issue.number,
        state: 'closed',
        labels: [
          'type: reaction',
          'reaction:state: invalid',
          ...argv.additionalIssueLabel,
        ]
      });
      octokit.rest.issues.createComment({
        owner: argv.githubRepositoryOwner,
        repo: argv.githubRepository,
        issue_number: issue.number,
        body: 'Sadly, this reaction is not allowed. 🙁',
      });
      octokit.rest.issues.lock({
        owner: argv.githubRepositoryOwner,
        repo: argv.githubRepository,
        issue_number: issue.number,
      });
    } else {
      const issueMetadata = {
        reactionId: argv.reactionId,
      };
      octokit.rest.issues.update({
        owner: argv.githubRepositoryOwner,
        repo: argv.githubRepository,
        issue_number: issue.number,
        state: 'closed',
        body:
          (_.isNil(issue.body) ? '' : issue.body) +
            '\n' +
            `<details>\n` +
            `\n` +
            '```json\n' +
            `${JSON.stringify(issueMetadata, null, 2)}\n` +
            '```\n' +
            `</details>\n`,
        labels: [
          ...argv.additionalIssueLabel,
          'type: reaction',
          'reaction:state: valid',
        ]
      });

      octokit.rest.issues.createComment({
        owner: argv.githubRepositoryOwner,
        repo: argv.githubRepository,
        issue_number: issue.number,
        body: 'Your reaction has been added! 🎉',
      });
      octokit.rest.issues.lock({
        owner: argv.githubRepositoryOwner,
        repo: argv.githubRepository,
        issue_number: issue.number,
      });
    }
  }

  // Give GitHub a bit of time to process potential changes
  await new Promise(r => setTimeout(r, 5000));

  const reactions = _.chain(await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: argv.githubRepositoryOwner,
    repo: argv.githubRepository,
    sort: 'created',
    direction: 'asc', // Oldest first
    state: 'closed',
    labels: [
      ...argv.additionalIssueLabel,
      'type: reaction',
      `reaction:state: valid`,
    ],
  }))
  .filter(issue => _.includes(issue.body, argv.reactionId))
  .filter(issue => !_.has(issue, 'pull_request'))
  .uniqBy('user.id')
  .map(issue => {
    return {
      reaction: issue.title,
      ..._.pick(issue, [
        'url',
        'number',
        'user.login',
        'user.url',
      ])
    }
  })
  .groupBy('reaction')
  .mapValues((reactions, reaction) => {
    return {
      count: _.size(reactions),
      reaction: reaction,
      reactions: reactions,
    };
  })
  .value();

  await fs.promises.writeFile(
    path.resolve(argv.output),
    JSON.stringify(reactions, null, 2),
  );
  console.log(`Generated reactions file to ${argv.output}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
