# Kick-off transcript: an app to book meeting rooms

> **Everything here is invented.** Ana, Ben and Carla are the PRD's made-up demo cast. Quillfeather Tea Co., the
> Teacup Building and every room name are fictional. No real person, company, building, product or address appears.
>
> **How to use it:** in demo step 3 Ana pastes everything below the line into Grillo, as the idea's kick-off chat.
> The chat raises questions and leaves them open on purpose; the cast answers them later from
> [`what-we-want.md`](what-we-want.md). Spoken aloud, the conversation runs about 14 minutes.

---

**Ana:** Thanks for joining, both of you. I want to keep this short. It's the first chat about the meeting room idea,
so nothing we say today is final. I just want us to agree what the problem is and what we don't know yet.

**Ben:** Sounds good. I've heard three versions of the problem in the kitchen this week, so I'd love to hear yours.

**Carla:** Same. And I want to hear early where this thing would live, before someone builds it on a spare laptop under
a desk.

**Ana:** Fair. So, the problem. Quillfeather Tea Co. has four meeting rooms in the Teacup Building, two on the ground
floor and two on the first floor. Today people book them on the paper sheet taped to each door, or they shout across
the office, or they just walk in. Last Tuesday two teams turned up for the Lighthouse room at ten, both sure they had
it. One of them had a customer with them. That was embarrassing.

**Ben:** The paper sheet on the Lighthouse door had two names in the ten o'clock box, didn't it? One in pencil.

**Ana:** One in pencil, one in pen, and the pen won because it was louder. So the idea is a small app where anyone in
the company can see which rooms are free and book one. On a laptop, and maybe on a screen outside each room.

**Carla:** When you say anyone in the company, do you mean everyone with a company sign-in? Or also visitors and
contractors? Because that changes how people log in.

**Ana:** Good question, and I don't know yet. My gut says staff only, but the sales team brings customers in all the
time, and sometimes the customer is the one who organises the follow-up meeting. Let's write that down as open.

**Ben:** Can I ask about the rooms themselves? Are they all the same? Because if one of them has the big screen and
the others don't, people will want to filter by that.

**Ana:** They're not the same. Lighthouse is the big one, about twelve seats, with the big screen and the
video-call kit. Haystack is about six seats with a whiteboard. Upstairs there's Moonbeam, which is four seats, and
Puddle, which is tiny, two people, mostly for phone calls.

**Ben:** Puddle. Of course it's called Puddle.

**Ana:** Someone named it after the leak from the roof. Anyway. Each room has a size and some equipment, and I think
people will want to search by those. Whether that's in the first version, I'm not sure.

**Carla:** And are there ever new rooms? Or rooms closed for a week because of painting? Because then someone needs to
be able to change the list without asking a developer.

**Ana:** Yes, that happens. The first-floor rooms were closed for two weeks in the spring. So someone, probably the
office team, needs to mark a room as closed for a period.

**Ben:** Okay. Booking rules, then. How long can someone book for? How far ahead? I ask because if there are no limits,
someone will book Lighthouse every Monday for the rest of the year and nobody else will ever get it.

**Ana:** That already happens on paper. The finance team writes "every Monday morning" at the top of the sheet. So yes,
we need rules. I'd like a maximum length, a limit on how far ahead you can book, and something for repeating meetings.
I don't have the numbers yet. That's one of the things I want to settle with the office team.

**Ben:** And what about people who book and never turn up? That's the other complaint I keep hearing. The room shows
booked, it's empty, and you can't use it.

**Ana:** Yes. Some kind of check-in, maybe. If nobody confirms they're in the room after a few minutes, the room
becomes free again. But that only works if there's something at the door to check in with, or a button in the app.

**Carla:** That's where the screens come in, I guess. If there's a small tablet outside each room, it can show free or
busy and have a check-in button. But then those tablets are four more devices that need power, network, updates, and
someone who notices when one dies.

**Ana:** Right. Is that a big deal?

**Carla:** Not huge, but it's real. They'd sit on the office network, they'd need to stay signed in without a person
behind them, and they'd need locking down so nobody uses them to browse the internet in the corridor. I'd want to
know whether they're in the first version before I plan anything.

**Ana:** Let's keep it open. I'd like them, but if they double the work I'd rather start with the app and add the
screens later.

**Ben:** On the developer side, the thing that scares me is double booking. Two people clicking "book" on the same
room for the same slot at the same moment. The app has to make sure only one of them wins, and the other one gets a
clear message, not a silent failure.

**Ana:** That's literally the Lighthouse problem from Tuesday. So yes, that has to be impossible.

**Ben:** It's solvable, but I need to know what a booking looks like before I design it. Is it any start and end time,
to the minute? Or fixed slots, like every fifteen minutes? Slots are much easier to reason about, and easier to show
on a screen.

**Ana:** I'd say slots. Nobody books a meeting at 10:07. But I'll check.

**Ben:** And the other question is the calendar. Everyone here lives in the company calendar. If I book Moonbeam in the
room app, does it appear in my calendar? And if I send a meeting invite in the calendar and add a room, does that
become a booking? Because if the two disagree, people will trust whichever one is wrong.

**Ana:** That's a big one. Ideally it works both ways. But I don't know how hard that is.

**Ben:** It's the hardest part of the whole thing, honestly. Two-way sync means handling the case where someone moves
the meeting in the calendar, or cancels it, or the calendar is down for an hour. One-way, from the room app into the
calendar, is much simpler.

**Carla:** And the calendar is run by the company's IT people, not by us. If the app talks to it, it needs some kind of
service account, and they'll want to know exactly what it can read and write. I'd want that conversation to happen
early, not the week before launch.

**Ana:** Noted. So: calendar connection, one-way or two-way, open. Who owns the conversation with IT, open.

**Ben:** What about notifications? If my booking gets released because I didn't check in, I'd want to know. And a
reminder ten minutes before would be nice.

**Ana:** The company chat tool, probably. Everyone has it open all day. Email gets ignored.

**Carla:** Same thing as the calendar, then. Another connection, another account, another thing to keep running. Fine,
but I'd like to keep the number of connections small at the start.

**Ana:** Agreed. Carla, you said you wanted to talk about where it lives.

**Carla:** Yes. A few things. First, sign-in. I'd strongly prefer it uses the company sign-in, so nobody has another
password, and when someone leaves the company, they lose access automatically. Second, where it runs. We have the
company's own servers. I'd want it there, not on some outside host, because the bookings say who meets whom and when,
and some of that is customer meetings.

**Ana:** That makes sense. Is it a lot of work?

**Carla:** Not if it's a normal small web app. What I need to know is how much it needs to be up. If the app is down
for an hour on a Saturday, nobody cares. If it's down at nine on a Monday, the whole office is back to shouting across
the floor. So I'd like an answer on working hours and how reliable it needs to be.

**Ben:** And backups. If we lose the bookings database, every meeting for the next month vanishes.

**Carla:** Exactly. Backups, and how long we keep old bookings. Do we keep a history of who booked what for years? A
month? There's a privacy angle there too: a full history of who met whom is quite personal.

**Ana:** I'd say we keep it for a while, because the office team wants to know which rooms are used and which aren't.
But not forever. Let's add it to the list.

**Ben:** On reporting: does the office team want reports inside the app, or just an export they can open in a
spreadsheet? Because building charts is a whole project on its own.

**Ana:** An export is probably enough to start. Room usage per week, that kind of thing. I'll confirm.

**Carla:** One more platform thing. Is this just the Teacup Building, or will the other office want it next year? If
there's ever a second building, I want to know now, because then rooms belong to a building, and time zones might
come in, and so on.

**Ana:** Just the Teacup Building for now. I've heard talk of a second office, but it's not real yet. Let's say one
building, and we don't block ourselves from adding another later.

**Ben:** Time zones matter anyway, even with one building. Someone dials in from abroad, books the room for a call, and
the app shows the wrong time. I'll keep everything in the building's own time zone unless you tell me otherwise.

**Ana:** Fine by me. Let me also say what I don't want, so we don't drift. I don't want catering orders. Someone asked
whether you could order biscuits with the room. No. I don't want desk booking, just meeting rooms. And I don't want
anything to do with billing other teams for room use.

**Ben:** What about a phone app?

**Ana:** I'd rather not build a separate phone app. If the web page works on a phone, that's enough.

**Carla:** Good. One less thing to publish and keep updated.

**Ana:** Okay. Let me read back what's open, so we can split it up. Product questions, mostly mine: who may book,
including visitors; the booking rules, meaning maximum length, how far ahead, repeating meetings, and what happens to
no-shows; which rooms and what equipment we list; and what's out of scope.

**Ben:** Developer questions, mine: how a booking is shaped, slots or free times; how we make double booking
impossible; one-way or two-way calendar sync; reminders through the chat tool; and the export for the office team.

**Carla:** Platform, mine: sign-in with the company account; hosting on the company's own servers; how reliable it
needs to be and when; backups and how long we keep the history; and whether the tablets at the doors are in the first
version, because they're devices I'd have to look after.

**Ana:** That's a good list. I'll take the product ones to the office team this week and write the answers down on one
page, so we all work from the same sheet.

**Ben:** Perfect. And please put the numbers on it, not "short" and "a while".

**Ana:** Numbers. Promise.

**Carla:** And put a clear out-of-scope list on it, so nobody adds biscuits in the second week.

**Ana:** Biscuits are out. Thanks, both.
