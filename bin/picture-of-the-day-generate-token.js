#!/usr/bin/env node

const _ = require('lodash');
const fs = require('fs');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const {authenticate} = require('@google-cloud/local-auth');
const path = require("path");

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 keyfile.json [options]')
  .demandCommand(1,
    'You need to specify the Client Secret keyfile. \n' +
    '\n' +
    '  1. Go to https://console.cloud.google.com/apis/credentials \n' +
    '  2. Select the correct OAuth 2.0 Client ID \n' +
    '  3. Press Download JSON \n'
  )
  .argv;

async function quickstart() {
  const localAuth = await authenticate({
    scopes: [
      // See https://developers.google.com/photos/library/guides/authorization
      // https://www.googleapis.com/auth/photoslibrary.readonly

      // Read access only.
      // List items from the library and all albums, access all media items and list albums owned by the user, including those which have been shared with them.
      // For albums shared by the user, share properties are only returned if the photoslibrary.sharing scope has also been granted.
      // The shareInfo property for albums and the contributorInfo for mediaItems is only available if the photoslibrary.sharing scope has also been granted.
      // For more information, see Share media.
      'https://www.googleapis.com/auth/photoslibrary.readonly',
    ],
    keyfilePath: path.resolve(argv._[0]),
  });
  console.log('Tokens:', localAuth.credentials);
}
quickstart();
