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
const Photos = require('googlephotos');
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

  const photos = new Photos(tokens.credentials.access_token);

  const getAllAlbums = async (pageSize, nextPageToken) => {
    const result = await photos.albums.list(pageSize, nextPageToken);
    return result.nextPageToken ?
      result.albums.concat(await getAllAlbums(pageSize, result.nextPageToken)) :
      result.albums;
  };
  const albums = await getAllAlbums(50);

  let album = _.find(albums, 'title', argv.album);
  if (!album) {
    console.warn(`Album with title '${argv.album}' not found.`);
    process.exit(0);
  }

  // Get all media items and select a Picture of the Day
  const getAllMediaItems = async (albumId, pageSize, nextPageToken) => {
    const result = await photos.mediaItems.search(albumId, pageSize, nextPageToken);
    return result.nextPageToken ?
      result.mediaItems.concat(await getAllMediaItems(albumId, pageSize, result.nextPageToken)) :
      result.mediaItems;
  };
  const mediaItems = await getAllMediaItems(album.id, 50);

  let pictureOfTheDay;
  let pictureOfTheDayMetadata = {};

  if (!_.size(mediaItems)) {
    console.error(`Could not get any pictures from the ${argv.album} album.`);
    process.exit(1);
  } else if (_.size(mediaItems) == 1) {
    console.info(`Only a single mediaItem available. There goes your randomness :')`);
    pictureOfTheDay = _.first(mediaItems);
  } else {
    // Select a random new picture.
    // If there is an JSON file available, is it to get a new image
    const getRandomMediaItem = () => {
      let previousId;
      try {
        previousId = _.get(require(path.resolve(argv.directory, argv.json)), 'id')
      } catch (e) {
        // The file might not be available, that is ok.
      }
      const item = _.first(_.shuffle(mediaItems));
      return item.id !== previousId ?
        item :
        getRandomMediaItem(previousId);
    };
    pictureOfTheDay = getRandomMediaItem();
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
    }
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

  await new Promise((resolve, reject) => {
    fs.mkdir(path.resolve(argv.directory), { recursive: true }, (err, directory) => {
      if (err) {
        reject(err);
      } else {
        resolve(directory)
      };
    });
  });

  const tmpDir = await new Promise((resolve, reject) => {
    fs.mkdtemp(path.join(os.tmpdir(), 'potd-'), (err, directory) => {
      if (err) {
        reject(err);
      } else {
        resolve(directory)
      };
    });
  });

  const exifTags = {
    IFD0: {
      Artist: 'Ingmar Delsink',
      Copyright:
        'This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License. ' +
        'To view a copy of this license, visit http://creativecommons.org/licenses/by-sa/4.0/',
      CreateDate: pictureOfTheDayMetadata.mediaMetadata.creationTime,
      ImageDescription: _.get(pictureOfTheDayMetadata, 'description', 'Picture of the Day'),
      Software: 'Picture of the Day. <https://github.com/idelsink/idelsink>',
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
      height: 800,
      fit: 'inside',
    })
    .webp({
      quality: 80,
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
