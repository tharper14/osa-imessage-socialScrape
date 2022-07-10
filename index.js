const yourUsername = 'socialscrape';
const dropBoxFolder = '_socialScrape'
const completedPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/masterCompletedLog.txt`
const linkPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/chatScrapeLinks.txt`
const missedLinkPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/missedLinks.txt`
const missedLogPath =  `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/missedLinksLog.txt`
const logPath = `/Users/${yourUsername}/Social Wake Dropbox/${dropBoxFolder}/logs/chatLog.txt`

const anamoly1 = `￼
https://www.tiktok.com/t/ZTdweoUe8/?k=1
Do we have permission to keep featuring your content? You’re constantly going viral!`

const anamoly2 = `￼
https://www.tiktok.com/t/ZTdE9NSym/?k=1
Full access on this lockpocking account lol`

const chatID = '679112890556703100'

const fs = require('fs')
const osa = require('osa2')
const ol = require('one-liner')
const assert = require('assert')
const macosVersion = require('macos-version')

const versions = require('./macos_versions')
const currentVersion = macosVersion()

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

if (!versions.working.includes(currentVersion)) {
    warn(`This version of macOS \(${currentVersion}) is currently
          untested with this version of osa-imessage. Proceed with
          caution.`)
}

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
    return osa(name => {
        const Messages = Application('Messages')
        return Messages.buddies.whose({ name: name })[0].handle()
    })(name)
}

// Gets the display name for a given handle
// TODO: support group chats
function nameForHandle(handle) {
    assert(typeof handle == 'string', 'handle must be a string')
    return osa(handle => {
        const Messages = Application('Messages')
        return Messages.buddies.whose({ handle: handle }).name()[0]
    })(handle)
}

// Sends a message to the given handle
function send(handle, message) {
    assert(typeof handle == 'string', 'handle must be a string')
    assert(typeof message == 'string', 'message must be a string')
    return osa((handle, message) => {
        const Messages = Application('Messages')

        let target

        try {
            target = Messages.buddies.whose({ handle: handle })[0]
        } catch (e) {}

        try {
            target = Messages.textChats.byId('iMessage;+;' + handle)()
        } catch (e) {}

        try {
            Messages.send(message, { to: target })
        } catch (e) {
            throw new Error(`no thread with handle '${handle}'`)
        }
    })(handle, message)
}

let emitter = null
let emittedMsgs = []
function listen() {
    // If listen has already been run, return the existing emitter
    if (emitter != null) {
        return emitter
    }

    // Create an EventEmitter
    emitter = new (require('events')).EventEmitter()

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
                    date: fromAppleTime(msg.date),
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

async function getRecentChats(limit=100) {
   const groupChat = '679112890556703100'
    var chatLogger = fs.createWriteStream(logPath, {
        flags: 'a'})// 'a' means appending (old data will be preserved)
    var writeChatLog = (line) => chatLogger.write(`\n${line}`);

    var linkScrape = fs.createWriteStream(linkPath, {
        flags: 'a'}) 
    var writeLink = (line) => linkScrape.write(`\n${line}`);

    var missedChatLogger = fs.createWriteStream(missedLogPath, {
        flags: 'a' })
    var writeMissedChatLog = (line) => missedChatLogger.write(`\n${line}`);

    var missedChatLinks = fs.createWriteStream(missedLinkPath, {
        flags: 'a'})
    var writeMissedChatLinks = (line) => missedChatLinks.write(`\n${line}`);


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
        WHERE cache_roomnames = ${groupChat}                
        AND text LIKE "%tiktok.com%"
     
        ORDER BY date ASC;
        LIMIT ${limit}
    `   //pull all text messages from clip chat that say "tiktok.com"
 //AND date > ${fromWhichDate}
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
            if (checkIfContainsSync(completedPath, chats[i].text) == false 
                    && checkIfContainsSync(linkPath, chats[i].text) == false
                    && chats[i].text != anamoly1 && chats[i].text != anamoly2) //if link[i] is not in completedLog AND not pulled from chat -if not loaded for next run (in chatScrapeLinks.txt)
                {
                    
                    writeLink(chats[i].text);  //write link to chatScrapeLinks.txt
                    //console.log(chats[i].text)
                    writeMissedChatLinks(`${chats[i].text}`);  //just a second source for troubleshooting, meant to be deleted everytime?
                    console.log(`${shortDate}, ${chats[i].text}, ${chats[i].handle}`)
                    //console.log(chats[i].text)

                }
                if (checkIfContainsSync(logPath, chats[i].text) ==false && chats[i].text != anamoly1 && chats[i].text != anamoly2 && chats[i].text != null ) //if chatlog doesnt contain the link or these two wierd texts that keep popping up -quick fix
                {
                    writeChatLog(`${shortDate}, ${chats[i].text}, ${chats[i].handle}`); //if not not logged, log it (chatLog.txt)
                    writeMissedChatLog(`${shortDate}, ${chats[i].text}, ${chats[i].handle}`); //if not not logged, log it (missedChatLog.txt)
                    
                } 
        }// end of loop

    return chats
}


//if this location contains this string, return true, if not return false
function checkIfContainsSync(filename, str) {

    let contents = fs.readFileSync(filename, 'utf-8');
    const result = contents.includes(str);
    return result;
}


module.exports = {
    send,
    listen,
    handleForName,
    nameForHandle,
    getRecentChats,
    SUPPRESS_WARNINGS: false,
}
