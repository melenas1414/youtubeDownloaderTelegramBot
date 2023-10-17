require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const ytdl = require('ytdl-core');
const fs = require('fs-extra');
const axios = require('axios');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');


const token = process.env.bot_token;
const api_url = 'http://telegram-api:8081';

// Mixte audio y video to youtube video
const mixAudioVideo = async function (url, videoNameNotAudio,  videoName, audioName, itag) {
    return new Promise(async (resolve, reject) => {
        let promise = [];
        promise.push(getVideo(url, itag, videoNameNotAudio));
        promise.push(getAudio(url, audioName));
        await Promise.all(promise);
        try {
            // mix audio and video
            ffmpeg()
                .input(videoNameNotAudio)
                .input(audioName)
                .outputOptions([
                    '-c:v copy',
                    '-c:a aac',
                    '-strict experimental',
                    '-map 0:v:0',
                    '-map 1:a:0',
                    '-shortest'
                ])
                .save(videoName)
                .on('end', () => {
                    fs.unlinkSync(videoNameNotAudio);
                    fs.unlinkSync(audioName);
                    resolve(videoName);
                });
            
        } catch (error) {
            fs.unlinkSync(videoNameNotAudio);
            fs.unlinkSync(audioName);

            reject(error);
        }
    });
}

const getAudio = function(url, name) {
    let audio = ytdl(url, {filter: 'audioonly'}).pipe(fs.createWriteStream(name));
    return new Promise((resolve, reject) => {
        audio.on('finish', () => resolve(name));
    });
}

const getVideo = function(url, itag, name) {
    let video = ytdl(url, { itag: itag }).pipe(fs.createWriteStream(name));
    return new Promise((resolve, reject) => {
        video.on('finish', () => resolve(name));
    });
}

const sendVideo = async function (chatId, video, info, format) {
    return new Promise(async (resolve, reject) => {
        try {
            const apiUrl = `${api_url}/bot${token}/sendVideo`;
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('video', fs.createReadStream(video));
            form.append('caption', `Title: ${info.videoDetails.title}`);
            form.append('width', format.width);
            form.append('height', format.height);
            form.append('duration', info.videoDetails.lengthSeconds);
            // form.append('supports_streaming', true);
            // Realiza la solicitud POST usando axios
            await axios.post(apiUrl, form, {
                headers: {
                    ...form.getHeaders(), // Encabezados para el formulario
                },
            }).then((response) => {
                resolve(response);
            }).catch((error) => {
                reject(error);
            });
        }
         catch (error) {
            bot.sendMessage(chatId, 'Error sending video: ' + error.message);
            reject(error);
        }
    });
}
       


// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, {polling: true});
// message start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Welcome to Youtube Downloader Bot');
    bot.sendMessage(msg.chat.id, 'Send me a YouTube video URL and I will download it for you.');
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Send me a YouTube video URL and I will download it for you.');
});
// any message get is url
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const url = msg.text;
    if (url === '/help' || url === '/start') {
        return;
    }
    if (ytdl.validateURL(url) == false) {
        return bot.sendMessage(chatId, 'Invalid URL');
    } 
    const video = await ytdl.getInfo(url);
    // get Type videos
    let formats = [];
    for (let i = 0; i < video.formats.length; i++) {
        if (!video.formats[i].hasVideo) {
            continue;
        }
        if (video.formats[i].container !== 'mp4') {
            continue;
        }
        if (video.formats[i].hasAudio !== false) {
            continue;
        }
        const quality = video.formats[i].qualityLabel;
        formats.push([{"text": `${quality} - ${video.formats[i].mimeType}`, "callback_data": `${url}|${video.formats[i].itag}` }]);
    }
    // send download button
    bot.sendMessage(chatId, 'Select format to download', {
        reply_markup: {
            inline_keyboard: formats,
        }
    });
    bot.on('callback_query', async (query) => {
        
        const selectedFormat = query.data;
        // Realiza la acción correspondiente con el formato seleccionado, por ejemplo, inicia la descarga.
        // Puedes enviar un mensaje de confirmación al usuario.
        let downloading = await bot.sendMessage(chatId, 'Downloading...');
        // get video from data 
        let url = selectedFormat.split('|')[0];
        let itag = selectedFormat.split('|')[1];
        // video info
        let info = await ytdl.getInfo(url);

        let format = info.formats.find(f => f.itag == itag);

        let folder = `/tmp/${Date.now()}/`;
        // create folders
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder);
        }
        let fileName = `${folder}${ytdl.getURLVideoID(url)}.${format.container}`;
        let fileNameNotAudio = `${folder}Not-audio-${ytdl.getURLVideoID(url)}.${format.container}`;
        let audioName = `${folder}${ytdl.getURLVideoID(url)}.mp3`;

    
        await mixAudioVideo(url, fileNameNotAudio,  fileName, audioName, itag);
        bot.deleteMessage(chatId, downloading.message_id);
        let messagePhoto = await bot.sendPhoto(chatId, (info.videoDetails.thumbnails[2].url), {
            'caption': 'Uploading...'
        });
        try {
            await sendVideo(chatId, fileName, info, format);
        } catch (error) {
            bot.message(chatId, 'Error sending video: ' + error.message);
        }
    
        // remove message
        bot.deleteMessage(chatId, messagePhoto.message_id);
        // remove folder
        fs.removeSync(folder);

    });
});