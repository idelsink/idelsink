#!/usr/bin/env node

require('dotenv').config();
const _ = require('lodash');
const {hideBin} = require('yargs/helpers');
const {google} = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const mime = require('mime-types');
const os = require('os');
const path = require("path");
const sharp = require('sharp');
const yargs = require('yargs/yargs');

const argv = yargs(hideBin(process.argv))
  .env('PICTURE_OF_THE_DAY')
  .usage('Usage: $0 [options]')
  .option('album', {
    describe: 'The Google Photos album to select a random picture.',
    default: 'Picture of the Day',
    type: 'string',
  })
  .option('googleClientId', {
    describe: 'Google Client ID.',
    type: 'string'
  })
  .option('googleClientSecret', {
    describe: 'Google Client Secret.',
    type: 'string'
  })
  .option('googleRefreshToken', {
    describe: 'Google refresh token.',
    type: 'string'
  })
  .option('output', {
    alias: 'directory',
    describe: 'Output directory to store the files to.',
    default: '',
    type: 'string'
  })
  .demandOption([
    'googleClientId',
    'googleClientSecret',
    'googleRefreshToken',
  ])
  .argv;
const metadataFilename = 'picture-of-the-day.json';

const listAlbums = async ({
  serviceEndpoint = 'https://photoslibrary.googleapis.com',
  bearerToken,
  pageSize = 50,
  pageToken,
  excludeNonAppCreatedData,
}) => {
  const response = await axios({
    method: 'GET',
    url: `${serviceEndpoint}/v1/albums`,
    responseType: 'json',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      ..._.omitBy({
        pageSize,
        pageToken,
        excludeNonAppCreatedData,
      }, _.isNil),
    },
  });
  return _.has(response, 'data.nextPageToken') ?
    _.concat(
      _.get(response, 'data.albums', []),
      await listAlbums({pageSize, pageToken: response.data.nextPageToken, excludeNonAppCreatedData}),
    ) :
    _.get(response, 'data.albums', []);
};
const searchMediaItems = async ({
  serviceEndpoint = 'https://photoslibrary.googleapis.com',
  bearerToken,
  albumId,
  pageSize = 50,
  pageToken,
  filters,
  orderBy,
}) => {
  const response = await axios({
    method: 'POST',
    url: `${serviceEndpoint}/v1/mediaItems:search`,
    responseType: 'json',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    data: {
      ..._.omitBy({
        albumId,
        pageSize,
        pageToken,
        filters,
        orderBy,
      }, _.isNil),
    },
  });
  return _.has(response, 'data.nextPageToken') ?
    _.concat(
      _.get(response, 'data.mediaItems', []),
      await listAlbums({
        albumId,
        pageSize,
        pageToken: response.data.nextPageToken,
        filters,
        orderBy,
      }),
    ) :
    _.get(response, 'data.mediaItems', []);
};

async function main() {
  console.log('Picture of the Day!');

  // Authenticate the client
  const oauth2Client = new google.auth.OAuth2(
    argv.googleClientId,
    argv.googleClientSecret,
    "",
  );
  oauth2Client.setCredentials({
    refresh_token: argv.googleRefreshToken,
  });
  const tokens = await oauth2Client.refreshAccessToken();

  const albums = await listAlbums({
    bearerToken: tokens.credentials.access_token,
  });

  let album = _.find(albums, 'title', argv.album);
  if (!album) {
    console.warn(`Album with title '${argv.album}' not found.`);
    process.exit(0);
  }

  const mediaItems = await searchMediaItems({
    bearerToken: tokens.credentials.access_token,
    albumId: album.id,
  });

  let previousIds = [];
  try {
    const previousMetadata = require(path.resolve(argv.directory, metadataFilename));
    previousIds = _.compact(_.concat(
      _.get(previousMetadata, 'previousIds', []),
      _.get(previousMetadata, 'id'),
    ));
  } catch (e) {
    // The file might not be available, that is ok.
  }
  let unseenMediaItems = _.filter(mediaItems, (o) => !_.includes(previousIds, o.id));

  if (!_.size(unseenMediaItems)) {
    console.info('All the items have been seen, starting over!')
    previousIds = [];
    unseenMediaItems = mediaItems;
  }

  let pictureOfTheDay;
  let pictureOfTheDayMetadata = {};

  if (!_.size(unseenMediaItems)) {
    console.error(`Could not get any pictures from the ${argv.album} album.`);
    process.exit(1);
  } else if (_.size(unseenMediaItems) == 1) {
    console.info(`Only a single item available. There goes your randomness :')`);
    pictureOfTheDay = _.first(unseenMediaItems);
  } else {
    pictureOfTheDay = _.first(_.shuffle(unseenMediaItems));
  }

  // Store mediaMetadata
  // And be verbose to not 'accidentally' leak more information than I want to.
  pictureOfTheDayMetadata = {
    id: `${_.get(pictureOfTheDay, 'id', '')}`,
    description: `${_.get(pictureOfTheDay, 'description', 'Picture of the Day')}`,
    mimeType: `${_.get(pictureOfTheDay, 'mimeType', '')}`,
    mediaMetadata: {
      creationTime: `${_.get(pictureOfTheDay, 'mediaMetadata.creationTime', '')}`,
      width: `${_.get(pictureOfTheDay, 'mediaMetadata.width', '')}`,
      height: `${_.get(pictureOfTheDay, 'mediaMetadata.height', '')}`,
    },
    artifacts: {
      // The generated artifacts
    },
    parsedMetadata: {
      creationTimeDateString: _.get(pictureOfTheDay, 'mediaMetadata.creationTime') ?
        new Date(_.get(pictureOfTheDay, 'mediaMetadata.creationTime')).toDateString() :
        '',
    },
    previousIds: previousIds,
  };

  downloadImage = async ({uri, destination}) => {
    const response = await axios({
      method: 'GET',
      url: uri,
      responseType: 'stream'
    });
    response.data.pipe(fs.createWriteStream(destination));
    return new Promise((resolve, reject) => {
      response.data.on('end', () => {
        resolve(path.resolve(destination));
      });
      response.data.on('error', () => {
        reject();
      });
    });
  };

  await fs.promises.mkdir(path.resolve(argv.directory), { recursive: true });

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'potd-'));

  const exifTags = {
    IFD0: {
      Artist: 'Ingmar Delsink',
      Copyright:
        'This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License. ' +
        'To view a copy of this license, visit http://creativecommons.org/licenses/by-sa/4.0/',
      CreateDate: pictureOfTheDayMetadata.mediaMetadata.creationTime,
      ImageDescription: _.get(pictureOfTheDayMetadata, 'description', 'Picture of the Day'),
      Software: 'Picture of the Day. https://github.com/idelsink/idelsink',
      UserComment: _.get(pictureOfTheDayMetadata, 'description', 'Picture of the Day'),
    },
  };

  const pictureOfTheDayPath = await downloadImage({
    uri: `${pictureOfTheDay.baseUrl}=w${pictureOfTheDay.mediaMetadata.width}-h${pictureOfTheDay.mediaMetadata.height}`,
    destination: path.resolve(tmpDir, `picture-of-the-day.${mime.extension(pictureOfTheDayMetadata.mimeType)}`)
  });

  console.info(`Saving files to '${path.resolve(argv.directory)}/'`);

  // Picture of the Day artifacts
  // artifact: original
  pictureOfTheDayMetadata.artifacts['original'] =
    `picture-of-the-day-original.${mime.extension(pictureOfTheDayMetadata.mimeType)}`;
  await sharp(pictureOfTheDayPath)
    .withMetadata({
      exif: exifTags
    })
    .toFile(path.resolve(argv.directory, pictureOfTheDayMetadata.artifacts.original));
  console.info(`Generated ${pictureOfTheDayMetadata.artifacts.original}`);

  // artifact: minimized
  pictureOfTheDayMetadata.artifacts['minimized'] =
    `picture-of-the-day-minimized.webp`;
  await sharp(pictureOfTheDayPath)
    .resize({
      width: 800,
      height: 400,
      fit: 'inside',
    })
    .webp({
      quality: 100,
    })
    .withMetadata({
      exif: exifTags
    })
    .toFile(path.resolve(argv.directory, pictureOfTheDayMetadata.artifacts.minimized));
  console.info(`Generated ${pictureOfTheDayMetadata.artifacts.minimized}`);

  await fs.promises.writeFile(
    path.resolve(argv.directory, metadataFilename),
    JSON.stringify(pictureOfTheDayMetadata, null, 2),
  );
  console.log(`Generated metadata file ${metadataFilename}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
