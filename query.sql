-- TODO:
-- Generalize this to work on all chats at once (rather than one at a time)
-- Filter out non-messages (likes/exclamations/etc. and pictures)
-- Can we filter out non-responses (e.g. a new text unrelated to a previous text from the other person)?

WITH grouped_messages AS (
WITH individual_messages AS (
-- Get all messages, ordered by person and then date (for now, filtered to one person)
SELECT
	ROW_NUMBER() OVER (ORDER BY chat.chat_identifier, message_date) AS id,
	message.text,
	chat.chat_identifier,
	message_date,
	message.is_from_me
FROM
    chat
    JOIN chat_message_join ON chat. "ROWID" = chat_message_join.chat_id
    JOIN message ON chat_message_join.message_id = message. "ROWID"
WHERE
	chat.chat_identifier = '[insert number here]'
ORDER BY
	chat.chat_identifier, message_date
)
-- Group adjacent texts from the same person together, and concatenate:
-- https://stackoverflow.com/questions/47170928/group-by-adjacent-records
SELECT ROW_NUMBER() over (order by min(Somedate)) as id, GROUP_CONCAT(text, '|') as content, is_from_me FROM
(SELECT  b.text as text, b.is_from_me, b.message_date AS Somedate, Min(a.message_date) AS Nextdate, a.is_from_me as n
 FROM individual_messages a JOIN individual_messages b
 ON a.message_date > b.message_date
 WHERE a.is_from_me <> b.is_from_me
 GROUP BY b.message_date) s1
GROUP BY is_from_me, Nextdate
ORDER BY Min(Somedate) asc)
-- Make prompt/completion pairs
SELECT pr.content as 'prompt', com.content as 'completion' FROM grouped_messages pr
JOIN grouped_messages com
WHERE pr.id + 1 = com.id
AND NOT pr.is_from_me
AND com.is_from_me