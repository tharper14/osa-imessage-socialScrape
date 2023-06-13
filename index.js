
const yourUsername = 'socialscrape';
const dropBoxFolder = '_socialScrape'
const completedPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/masterCompletedLog.txt`
const linkPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/chatScrapeLinks.txt`
//const missedLinkPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/missedLinks.txt`
//const missedLogPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/missedLinksLog.txt`
const logPath = `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/chatLog.txt`
const specialLogPath =`/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/specialChatLog.txt`
const badLinksPath = `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/badLinks.txt`
//const igScrapePath = `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/igScrape.txt`
const linkPathSpecial = `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/specialChatScrape.txt`
const duplicatePath = `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/duplicateLinks.txt`
let bufferData = [];
let bufferChatLog = [];
let bufferDataSpecial = [];
let bufferSpecialLog = [];
let bufferDuplicate = [];

const ttOnlyChat = "'chat652293730519823796'"
const igSpecialChat = "'chat222048912579693603'"

const newClipsChat = "'chat111361966382305246'"
const foreignChat = "'chat587918592434941822'"
const thumbsChat = "'chat862372514310478630'"
const tagsChat = "'chat520420209340163432'"
const skChat = "'chat951176133862785356'"

const fs = require('fs')
const osa = require('osa2')
const ol = require('one-liner')
const assert = require('assert')
const macosVersion = require('macos-version')

const versions = require('./macos_versions')
const currentVersion = macosVersion()
const isParticipant = (macosVersion.is('>=14.0')) ? true : false

const messagesDb = require('./lib/messages-db.js')



function warn(str) {
    if (!process.env.SUPPRESS_OSA_IMESSAGE_WARNINGS) {
        console.error(ol(str))
    }
}

if (versions.broken.includes(currentVersion)) {
    console.error(
        ol(`This version of macOS \(${currentVersion}) is known to be
            incompatible with osa-imessage. Please upgrade either
            macOS or osa-imessage.`)
    )
    process.exit(1)
}

//if (!versions.working.includes(currentVersion)) {
 //   warn(`This version of macOS \(${currentVersion}) is currently
 //         untested with this version of osa-imessage. Proceed with
 //        caution.`)
//}

// Instead of doing something reasonable, Apple stores dates as the number of
// seconds since 01-01-2001 00:00:00 GMT. DATE_OFFSET is the offset in seconds
// between their epoch and unix time
const DATE_OFFSET = 978307200

// Gets the current Apple-style timestamp
function appleTimeNow() {
    return Math.floor(Date.now() / 1000) - DATE_OFFSET
}

// Transforms an Apple-style timestamp to a proper unix timestamp
function fromAppleTime(ts) {
    if (ts == 0) {
        return null
    }

    // unpackTime returns 0 if the timestamp wasn't packed
    // TODO: see `packTimeConditionally`'s comment
    if (unpackTime(ts) != 0) {
        ts = unpackTime(ts)
    }
    
    return new Date((ts + DATE_OFFSET/*-14400*/) * 1000)
  
}

// Since macOS 10.13 High Sierra, some timestamps appear to have extra data
// packed. Dividing by 10^9 seems to get an Apple-style timestamp back.
// According to a StackOverflow user, timestamps now have nanosecond precision
function unpackTime(ts) {
    return Math.floor(ts / Math.pow(10, 9))
}

// TODO: Do some kind of database-based detection rather than relying on the
// operating system version
function packTimeConditionally(ts) {
    if (macosVersion.is('>=10.13')) {
        return ts * Math.pow(10, 9)
    } else {
        return ts
    }
}

// Gets the proper handle string for a contact with the given name
function handleForName(name) {
    assert(typeof name == 'string', 'name must be a string')
    // return osa(name => {
        return osa((name, isParticipant) => {
        const Messages = Application('Messages')
        return (isParticipant ? Messages.participants.whose({ name: name })[0].handle() : Messages.buddies.whose({ name: name })[0].handle())
    })(name, isParticipant)
}

// Gets the display name for a given handle
// TODO: support group chats
function nameForHandle(handle) {
    assert(typeof handle == 'string', 'handle must be a string')
    return osa((handle, isParticipant) => {
        const Messages = Application('Messages')
        return (isParticipant ? Messages.participants.whose({ handle: handle })[0].name() : Messages.buddies.whose({ handle: handle })[0].name())
    })(handle, isParticipant)
}

// Sends a message to the given handle
function send(handle, message) {
    assert(typeof handle == 'string', 'handle must be a string')
    assert(typeof message == 'string', 'message must be a string')
    // return osa((handle, message) => {
        return osa((handle, message, isParticipant) => {
        const Messages = Application('Messages')

        let target

        try {
            target = isParticipant ? Messages.participants.whose({ handle: handle })[0] :  Messages.buddies.whose({ handle: handle })[0]
        } catch (e) {}

        try {
            target = Messages.textChats.byId('iMessage;+;' + handle)()
        } catch (e) {}

        try {
            Messages.send(message, { to: target })
        } catch (e) {
            throw new Error(`no thread with handle '${handle}'`)
        }
    // })(handle, message)
})(handle, message, isParticipant)
}

let emitter = null
let emittedMsgs = []

function listen() {
    // If listen has already been run, return the existing emitter
    if (emitter != null) {
        return emitter
    }

    // Create an EventEmitter
    emitter = new(require('events')).EventEmitter()

    let last = packTimeConditionally(appleTimeNow() - 5)
    let bail = false

    const dbPromise = messagesDb.open()

    async function check() {
        const db = await dbPromise
        const query = `
            SELECT
                guid,
                id as handle,
                text,
                date,
                date_read,
                is_from_me,
                cache_roomnames
            FROM message
            LEFT OUTER JOIN handle ON message.handle_id = handle.ROWID
            WHERE date >= ${last}
            AND text NOT LIKE "%Disliked%"
        `
        last = packTimeConditionally(appleTimeNow())

        try {
            const messages = await db.all(query)
            messages.forEach(msg => {
                if (emittedMsgs[msg.guid]) return
                emittedMsgs[msg.guid] = true
                emitter.emit('message', {
                    guid: msg.guid,
                    text: msg.text,
                    handle: msg.handle,
                    group: msg.cache_roomnames,
                    fromMe: !!msg.is_from_me,
                    date: msg.date,//fromAppleTime(msg.date),
                    dateRead: fromAppleTime(msg.date_read),
                })
            })
            setTimeout(check, 1000)
        } catch (err) {
            bail = true
            emitter.emit('error', err)
            warn(`sqlite returned an error while polling for new messages!
                  bailing out of poll routine for safety. new messages will
                  not be detected`)
        }
    }

    if (bail) return
    check()

    return emitter
}

async function getRecentChats(chatStartDate,chat1,chat2,chat3,chat4) { 

    const db = await messagesDb.open()
      
    const query = `
        SELECT
            guid,
            id as handle,
            text,
            date,
            is_from_me,
            cache_roomnames
        FROM message
        LEFT OUTER JOIN handle ON message.handle_id = handle.ROWID
        WHERE (cache_roomnames = ${chat1} OR cache_roomnames = ${chat2} OR cache_roomnames = ${chat3} OR cache_roomnames = ${chat4} )             
        AND (text LIKE "%https://%" AND text NOT LIKE "%Disliked%")
        AND date > ${chatStartDate};
        ORDER BY date ASC;
        
    `   
    const chats = await db.all(query)

    
    for (let i = 0; i < chats.length; i++){//loop through ${limit} chats
        
            let fullDate = fromAppleTime(chats[i].date)
            let shortDate = fullDate.toLocaleString('en-US', {
                timeZone: 'America/New_York',
                year: "2-digit",
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                /* timeStyle: 'full'*/ })
            
            let text = chats[i].text
            const urlPattern = /(https?:\/\/[^\s]+)/g;
            const matches = text.match(urlPattern);
            
            let link;
            
            if (matches && matches.length > 1) {
              link = matches;
              //console.log(`All links: ${link.join(",")}`);
            } else {
              link = matches ? matches[0] : null;
              //console.log(`Link: ${link}`);
            }
            
            if (Array.isArray(link)) {
              //console.log("Link is an array");
            } else {
             // console.log("Link is a string");
            }

            let chatID = '';

            if (chats[i].cache_roomnames == 'chat111361966382305246')
            {chatID = "NC"}
            if (chats[i].cache_roomnames == 'chat587918592434941822')
            {chatID = "FC"}
            if (chats[i].cache_roomnames == 'chat862372514310478630')
            {chatID = "TH"}
            if (chats[i].cache_roomnames == 'chat520420209340163432')
            {chatID = "TAG"}
            if (chats[i].cache_roomnames == 'chat951176133862785356')
            {chatID = "SK"}
            
           

            let linkInstance = `${shortDate}, ${link}, ${chats[i].handle}, ${chatID}`
            if (checkIfContainsSync(completedPath, link) == false 
                    && checkIfContainsSync(linkPath, link) == false
                    && checkIfContainsSync(badLinksPath, link) == false){ //if link[i] is not in completedLog AND not pulled from chat -if not loaded for next run (in chatScrapeLinks.txt)
                
                   //bufferData.push(chatScrapeInstance) <<< future update
                   bufferData.push(link)
                   bufferChatLog.push(linkInstance);
                   console.log(linkInstance)
                }
               
                let dupCheck = checkIfContainsSyncReturnLine(logPath, link);

                if (checkIfContainsSync(logPath, linkInstance) ==false && chats[i].text != null && dupCheck != false && checkIfContainsSync(duplicatePath, linkInstance) ==false && link !=' https://www.tiktok.com/t/ZTRvw4KyS/' ) //if chatlog doesnt contain the link or these two wierd texts that keep popping up -quick fix
                {
                   //link has already been submitted by somebody else
                    const phoneNumber = '+19372439400'; 
                    const messageText = `VOID ${linkInstance}, link was previously found on ${dupCheck}`; 
                    bufferDuplicate.push(linkInstance)

                    send(phoneNumber, messageText)
                    .then(() => console.log('Message sent successfully!'))
                    .catch((err) => console.error('Error sending message:', err));

                } 
        }// end of loop


     //Writing data to text files after checking against them to avoid write while reading complications..
     //___________________________________________________________________________________________________

     //WRITE LINKS STORED IN bufferData TO TEXT FILE   
    var linkScrape = fs.createWriteStream(linkPath, {
            flags: 'a'}) 
    var writeLink = (line) => linkScrape.write(`\n${line}`);
    for(let j=0; j< bufferData.length; j++){
              writeLink(bufferData[j]);  //write link to chatScrapeLinks.txt
    }
    //WRITE LOGS STORED IN bufferChatLog TO TEXT FILE 
    var chatLogger = fs.createWriteStream(logPath, {
            flags: 'a'})// 'a' means appending (old data will be preserved)
    var writeChatLog = (line) => chatLogger.write(`\n${line}`);

    for(let k=0; k< bufferChatLog.length; k++){
            writeChatLog(bufferSpecialLog[k]);  //write link to chatLog
    }
    //WRITE DUPLICATE LINKS STORED IN bufferDuplicate TO TEXT FILE
    var dupLogger = fs.createWriteStream(duplicatePath, {
        flags: 'a'})// 'a' means appending (old data will be preserved)
    var writeDupLog = (line) => dupLogger.write(`\n${line}`);

    for(let x=0; x< bufferDuplicate.length; x++){
        writeDupLog(bufferDuplicate[x]);  //write link to chatLog
    }



    //return chats
}
//______________________________________________________________________________________________
async function getRecentSpecial(chatStartDate, chat1) { 
   
   
    const db = await messagesDb.open()

    const query = `
        SELECT
            guid,
            id as handle,
            text,
            date,
            is_from_me,
            cache_roomnames
        FROM message
        LEFT OUTER JOIN handle ON message.handle_id = handle.ROWID
        WHERE cache_roomnames = ${chat1}              
        AND (text LIKE "%https://%" AND text NOT LIKE "%Disliked%")
        AND date > ${chatStartDate};
        ORDER BY date ASC;
        
    ` 
    const chats = await db.all(query)

    for (let i = 0; i < chats.length; i++)//loop through ${limit} chats
        {
                    let fullDate = fromAppleTime(chats[i].date)
                    let shortDate = fullDate.toLocaleString('en-US', {
                        timeZone: 'America/New_York',
                        year: "2-digit",
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        /* timeStyle: 'full'*/ })
                        let text = chats[i].text

                        //pull a link from the text (if text contained any extra text besides the link)
                        const urlPattern = /(https?:\/\/[^\s]+)/g;
                        const matches = text.match(urlPattern);
                        let link = "";

                        if (matches && matches.length > 1) {
                        const [link1, link2, ...restLinks] = matches;
                        //console.log(`Link 1: ${link1}`);console.log(`Link 2: ${link2}`);
                        restLinks.forEach((link, index) => {
                            //console.log(`Link ${index + 3}: ${link}`);
                        });
                        link = matches.join(",");
                        } else {
                        const links = matches ? matches[0] : null;
                        //console.log(`Link: ${links}`);
                        link = links;
                        }

                        //console.log(`All links: ${linksString}`);
                        let chatID = '';
                        if (chats[i].cache_roomnames == 'chat111361966382305246')
                        {chatID = "NC"}
                        if (chats[i].cache_roomnames == 'chat587918592434941822')
                        {chatID = "FC"}
                        if (chats[i].cache_roomnames == 'chat862372514310478630')
                        {chatID = "TH"}
                        if (chats[i].cache_roomnames == 'chat520420209340163432')
                        {chatID = "TAG"}
                        if (chats[i].cache_roomnames == 'chat951176133862785356')
                        {chatID = "SK"}
                        // let chatScrapeInstance = `${link}, ${chatID}, ${chats[i].handle}, ${shortDate}`;
                        let linkInstance = `${shortDate}, ${link}, ${chats[i].handle}, ${chatID}`
                    if (checkIfContainsSync(completedPath, link) == false 
                        && checkIfContainsSync(linkPathSpecial, link) == false
                        && checkIfContainsSync(badLinksPath, link) == false){ 
                        //if link[i] is not in masterCompletedLog AND not already in chatScrapeLinks AND not in badLinks.txt already
                    
                        // bufferDataSpecial.push(chatScrapeInstance) << future for chat update
                        bufferDataSpecial.push(link)
                        bufferSpecialLog.push(linkInstance);
                        console.log(linkInstance)
                    }

                    let dupCheck = checkIfContainsSyncReturnLine(logPath, link)
                    if (dupCheck != false && checkIfContainsSync(specialLogPath, linkInstance) ==false && link != "" &&  checkIfContainsSync(duplicatePath, linkInstance) ==false && link !=' https://www.tiktok.com/t/ZTRvw4KyS/' ) //if chatlog doesnt contain the link or these two wierd texts that keep popping up -quick fix
                    {
                       //link has already been submitted by somebody else
                        const phoneNumber = '+19372435942'; // Replace with the phone number you want to send the message to
                        const messageText = `VOID ${linkInstance}, link was previously found on ${dupCheck}`; // Replace with the text you want to send
                        bufferDuplicate.push(linkInstance)
    
                        send(phoneNumber, messageText)
                        .then(() => console.log('Message sent successfully!'))
                        .catch((err) => console.error('Error sending message:', err));
    
                    } 

            }// end of loop


    //WRITE LINKS STORED IN bufferData TO TEXT FILE   
    var linkScrapeSpecial = fs.createWriteStream(linkPathSpecial, {
        flags: 'a'}) 
    var writeLinkSpecial = (line) => linkScrapeSpecial.write(`\n${line}`);
    for(let j=0; j< bufferDataSpecial.length; j++){
        writeLinkSpecial(bufferDataSpecial[j]);  //write link to chatScrapeLinks.txt
    }

    //WRITE LOGS STORED IN bufferChatLog TO TEXT FILE 
    var specialLogger = fs.createWriteStream(specialLogPath, {
            flags: 'a'})// 'a' means appending (old data will be preserved)
    var writeSpecialLog = (line) => specialLogger.write(`\n${line}`);
    for(let k=0; k< bufferSpecialLog.length; k++){
            writeSpecialLog(bufferChatLog[k]);  //write link to chatLog
    }

    //WRITE DUPLICATE LINKS STORED IN bufferDuplicate TO TEXT FILE
    var dupLogger = fs.createWriteStream(duplicatePath, {
        flags: 'a'})// 'a' means appending (old data will be preserved)
    var writeDupLog = (line) => dupLogger.write(`\n${line}`);

    for(let x=0; x< bufferDuplicate.length; x++){
        writeDupLog(bufferDuplicate[x]);  //write link to chatLog
    }

    //return chats
}
//______________________________________________________________________________________________

// async function globalLog(chatStartDate, chatEndDate, newClipsChat,tagsChat,thumbsChat,skChat) {
async function globalLog(chatStartDate, /*chatEndDate,*/ chat1, chat2, chat3, chat4, chat5, chat6) {
   
    

    const db = await messagesDb.open()
   
    const query = `
        SELECT
            guid,
            id as handle,
            text,
            date,
            is_from_me,
            cache_roomnames
        FROM message
        LEFT OUTER JOIN handle ON message.handle_id = handle.ROWID
        WHERE (cache_roomnames = ${chat1} OR cache_roomnames = ${chat2} OR cache_roomnames = ${chat3} OR cache_roomnames = ${chat4} OR cache_roomnames = ${chat5} OR cache_roomnames = ${chat6} )
        AND (text LIKE "%tiktok.com%" OR text LIKE "%instagram.com%")
        AND (date > ${chatStartDate} )
        
        ORDER BY date ASC;
        
    `
    //AND date < ${chatEndDate}


    const chats = await db.all(query)
   
    // for (let i = 0; i < chats.length; i++)//loop through ${limit} chats
    // {
    //     console.log(chats[i].date)
    // }
   
    return chats
}



//if this location contains this string, return true, if not return false
function checkIfContainsSync(filename, str) {

    let contents = fs.readFileSync(filename, 'utf-8');
    const result = contents.includes(str);
    return result;
}

function checkIfContainsSyncReturnLine(filename, str) {
    const contents = fs.readFileSync(filename, 'utf-8');
    const lines = contents.split(/\r?\n/);

    for (const line of lines) {
        if (line.includes(str)) {
            return line;
        }
    }
    return false;
}

module.exports = {
    send,
    listen,
    handleForName,
    nameForHandle,
    getRecentChats,
    globalLog,
    getRecentSpecial,
    SUPPRESS_WARNINGS: false,
}
