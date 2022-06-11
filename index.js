const linkPath = '/Users/socialscrape/Social Wake Dropbox/Tylers Tests/chatScrape.txt'
const logPath = '/Users/socialscrape/Social Wake Dropbox/Tylers Tests/chatLog.txt'
// const linkPath = '/Users/socialscrape/Social Wake Dropbox/Social Scrape/chatScrape.txt'
// const logPath = '/Users/socialscrape/Social Wake Dropbox/Social Scrape/testLog.txt'



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

async function getRecentChats(limit = 100) {
   

    var linkScrape = fs.createWriteStream(linkPath, {
        flags: 'a' // 'a' means appending (old data will be preserved)
      })
    
      var chatLogger = fs.createWriteStream(logPath, {
        flags: 'a' // 'a' means appending (old data will be preserved)
      })
      var writeLink = (line) => linkScrape.write(`\n${line}`);
      var writeChatLog = (line) => chatLogger.write(`\n${line}`);

    const db = await messagesDb.open()

    const query = `
        SELECT
            guid,
            id as handle,
            text,
            date,
            is_from_me
        FROM message
        LEFT OUTER JOIN handle ON message.handle_id = handle.ROWID
        ORDER BY date DESC
        LIMIT ${limit};
    `

    const chats = await db.all(query)

    for (let i = 0; i < chats.length; i++)//loop through ${limit} chats
        {
            if (chats[i].text !== null && chats[i].text.includes("tiktok.com")/* && !chats[i].text.includes('Disliked')&& chats[i].group !== undefined && chats[i].group.includes("chat652293730519823796")*/)//if text contains tiktok.com...
            {
                fs.readFile(linkPath, function (err, data) { //read chatScrape.txt...
                    if (err) throw err;

                    if(data.includes(chats[i].text)){ //if link i is in cchatScrape.txt...
                     console.log("Link " +i+ " already logged")
                    }
                    else  //if not in chatLog, add it to chatLog
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
                            // timeStyle: 'full'
                          })
                        console.log(shortDate);
                         
                         writeChatLog(`${shortDate}, ${chats[i].text}, ${chats[i].handle}`);
                         writeLink(chats[i].text);
                         console.log("Link Added");    
                    }
                  });
                
            }
        }// end of loop
    //console.log(chats[0])
    return chats
}

module.exports = {
    send,
    listen,
    handleForName,
    nameForHandle,
    getRecentChats,
    SUPPRESS_WARNINGS: false,
}
