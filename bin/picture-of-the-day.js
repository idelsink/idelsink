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
  .usage('Usage: $0 [options]')
  .option('album', {
    describe: 'The Google Photos album to select a random picture.',
    default: 'Picture of the Day',
    type: 'string',
  })
  .option('output', {
    alias: 'directory',
    describe: 'Output directory to store the files to.',
    default: '',
    type: 'string'
  })
  .option('json', {
    describe: 'Filename to store the JSON information to.',
    default: 'picture-of-the-day.json',
    type: 'string'
  })
  .argv;

async function main() {
  console.log('Picture of the Day!');

  // Authenticate the client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "",
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
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
    description: `${_.get(pictureOfTheDay, 'description', '')}`,
    mimeType: `${_.get(pictureOfTheDay, 'mimeType', '')}`,
    mediaMetadata: {
      creationTime: `${_.get(pictureOfTheDay, 'mediaMetadata.creationTime', '')}`,
      width: `${_.get(pictureOfTheDay, 'mediaMetadata.width', '')}`,
      height: `${_.get(pictureOfTheDay, 'mediaMetadata.height', '')}`,
    },
    artifacts: {
      // The generated artifacts
    },
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
        resolve();
      });
      response.data.on('error', () => {
        reject();
      });
    });
  };

  await new Promise((resolve, reject) => {
    fs.mkdir(path.resolve(argv.directory), (err, directory) => {
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
        'To view a copy of this license, visit <http://creativecommons.org/licenses/by-sa/4.0/>',
      CreateDate: pictureOfTheDayMetadata.mediaMetadata.creationTime,
      ImageDescription: pictureOfTheDayMetadata.description || 'Picture of the Day',
      Software: 'Picture of the Day. <https://github.com/idelsink/idelsink>',
      UserComment: pictureOfTheDayMetadata.description || 'Picture of the Day',
    },
  };

  // Picture of the Day artifacts
  // artifact: original
  pictureOfTheDayMetadata.artifacts['original'] =
    `picture-of-the-day-original.${mime.extension(pictureOfTheDayMetadata.mimeType)}`;

  await downloadImage({
    uri: `${pictureOfTheDay.baseUrl}=w${pictureOfTheDay.mediaMetadata.width}-h${pictureOfTheDay.mediaMetadata.height}`,
    destination: path.resolve(tmpDir, pictureOfTheDayMetadata.artifacts.original)
  });

  await sharp(path.resolve(tmpDir, pictureOfTheDayMetadata.artifacts.original))
    .withMetadata({
      exif: exifTags
    })
    .toFile(path.resolve(argv.directory, pictureOfTheDayMetadata.artifacts.original));
  console.info(`Saved original to '${path.resolve(argv.directory, pictureOfTheDayMetadata.artifacts.original)}'`);

  await fs.promises.writeFile(
    path.resolve(argv.directory, argv.json),
    JSON.stringify(pictureOfTheDayMetadata, null, 2),
  );
  console.log(`Saved json metadata to '${path.resolve(argv.directory, argv.json)}'`);
}

main().catch(console.error);
