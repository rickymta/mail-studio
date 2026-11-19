#!/usr/bin/env python3
"""A throw-away IMAP + SMTP server for developing MailStudio without a real mailbox.

    python scripts/dev-mail-server.py [--imap 1143] [--smtp 1025]

Everything lives in memory and is gone when the process stops. Any user name and password are
accepted; every user gets Inbox, Sent, Drafts, Trash, Junk and Archive. Mail sent through the SMTP
port is delivered to the Inbox of each recipient, so two accounts added in the app can write to
each other. Two users start with sample mail: demo@mailstudio.test and second@mailstudio.test.

In MailStudio add an account with provider "Other", server 127.0.0.1, security "None", IMAP port
1143 and SMTP port 1025.

Only the commands MailStudio uses are implemented; this is not a general-purpose server and must
never be exposed beyond localhost.
"""

import argparse
import asyncio
import base64
import re
import time
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from datetime import datetime, timedelta, timezone

SPECIAL = {"Sent": "\\Sent", "Drafts": "\\Drafts", "Trash": "\\Trash", "Junk": "\\Junk", "Archive": "\\Archive"}
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


class Msg:
    def __init__(self, uid, raw, flags=(), when=None):
        self.uid = uid
        self.raw = raw
        self.flags = set(flags)
        self.when = when or datetime.now(timezone.utc)


class Mailbox:
    def __init__(self):
        self.msgs = []
        self.uidnext = 1
        self.uidvalidity = int(time.time()) % 100000 + 1

    def add(self, raw, flags=(), when=None):
        m = Msg(self.uidnext, raw, flags, when)
        self.uidnext += 1
        self.msgs.append(m)
        return m


class Store:
    def __init__(self):
        self.users = {}

    def user(self, name):
        name = name.lower()
        if name not in self.users:
            self.users[name] = {n: Mailbox() for n in ["INBOX", *SPECIAL]}
        return self.users[name]

    def deliver(self, rcpt, raw):
        self.user(rcpt)["INBOX"].add(raw)


STORE = Store()


def sample(frm, to, subject, text, html=None, attachment=None, days_ago=0, inline=False):
    m = EmailMessage()
    m["From"], m["To"], m["Subject"] = frm, to, subject
    when = datetime.now(timezone.utc) - timedelta(days=days_ago, minutes=7 * days_ago)
    m["Date"] = format_datetime(when)
    m["Message-ID"] = make_msgid(domain="mailstudio.test")
    m.set_content(text)
    if html:
        m.add_alternative(html, subtype="html")
        if inline:
            m.get_payload()[1].add_related(PNG, "image", "png", cid="<logo@mailstudio.test>")
    if attachment:
        name, data, (main, sub) = attachment
        m.add_attachment(data, maintype=main, subtype=sub, filename=name)
    return m.as_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"), when


def seed():
    demo, second = "demo@mailstudio.test", "second@mailstudio.test"
    inbox = STORE.user(demo)["INBOX"]
    items = [
        sample("Nguyễn Thu Hà <ha@example.vn>", demo, "Lịch họp tuần này",
               "Chào bạn,\n\nCuộc họp dời sang 9:30 sáng thứ Năm tại phòng 4.\nXem thêm: https://example.com/lich-hop\n\nHà", days_ago=0),
        sample("Acme Billing <billing@acme.example>", demo, "Your invoice #1042 is ready",
               "Your invoice is attached.",
               '<div style="font-family:Arial;max-width:560px"><h2 style="color:#1f6fb8">Invoice #1042</h2>'
               '<p>Hello, your invoice for <b>November</b> is attached.</p>'
               '<table width="100%" cellpadding="6" style="border-collapse:collapse;border:1px solid #ddd">'
               '<tr bgcolor="#f3f5f7"><td>Plan</td><td align="right">Amount</td></tr>'
               '<tr><td>Team</td><td align="right">$49.00</td></tr></table>'
               '<p><a href="https://acme.example/pay/1042">Pay online</a></p>'
               '<img src="https://acme.example/track/open.gif" width="1" height="1"></div>',
               attachment=("invoice-1042.pdf", b"%PDF-1.4\n% dev sample\n", ("application", "pdf")), days_ago=1),
        sample("Design Weekly <news@designweekly.example>", demo, "Issue 212: colour systems that scale",
               "Read this issue online.",
               '<style>.hero{background:#10243e;color:#fff;padding:24px}</style><div class="hero"><h1>Design Weekly</h1></div>'
               '<p style="padding:0 24px">Inline logo: <img src="cid:logo@mailstudio.test" width="24" height="24" alt="logo">'
               ' and a remote picture: <img src="https://designweekly.example/cover.png" width="320" alt="cover"></p>'
               '<p onclick="alert(1)" style="padding:0 24px">Scripts are removed.<script>alert(1)</script></p>',
               days_ago=2, inline=True),
        sample("Trần Minh <minh@example.vn>", f"{demo}, {second}", "Re: Báo cáo quý 3",
               "Mình đã xem, số liệu ổn. Gửi kèm bảng tính.\n\n> Bạn xem giúp báo cáo nhé.",
               attachment=("bao-cao-q3.csv", "thang,doanh_thu\n7,120\n8,135\n9,150\n".encode(), ("text", "csv")), days_ago=3),
        sample("GitHub <noreply@github.example>", demo, "[mail-studio] Pull request #7 was merged",
               "Merged #7 into main.\n\n-- \nYou are receiving this because you authored the thread.", days_ago=5),
        sample("Lê Quang <quang@example.vn>", demo, "Ảnh chuyến đi Đà Lạt",
               "Gửi bạn vài tấm ảnh.", attachment=("da-lat.png", PNG, ("image", "png")), days_ago=9),
    ]
    for i, (raw, when) in enumerate(items):
        inbox.add(raw, flags=() if i < 3 else ("\\Seen",), when=when)
    for n in range(1, 13):
        raw, when = sample(f"Bot {n} <bot{n}@example.com>", demo, f"Daily digest #{n}", f"Digest number {n}.", days_ago=10 + n)
        inbox.add(raw, flags=("\\Seen",), when=when)
    raw, when = sample(f"Demo <{demo}>", "ha@example.vn", "Re: Lịch họp tuần này", "Mình sẽ có mặt. Cảm ơn Hà!", days_ago=0)
    STORE.user(demo)["Sent"].add(raw, flags=("\\Seen",), when=when)
    raw, when = sample("Prize Dept <win@spam.example>", demo, "You WON!!!", "Click here.", days_ago=1)
    STORE.user(demo)["Junk"].add(raw, when=when)
    STORE.user(demo)["Projects"] = Mailbox()
    # Mailbox names travel in modified UTF-7: this one is "Projects/Khách hàng".
    STORE.user(demo)["Projects/Kh&AOE-ch h&AOA-ng"] = Mailbox()
    raw, when = sample(f"Demo <{demo}>", second, "Chào tài khoản thứ hai", "Thư mẫu giữa hai tài khoản.", days_ago=0)
    STORE.user(second)["INBOX"].add(raw, when=when)


# ---- IMAP ---------------------------------------------------------------------------------------

TOKEN = re.compile(rb'"((?:[^"\\]|\\.)*)"|\(([^)]*)\)|(\S+)')


def tokens(line):
    out = []
    for q, p, a in TOKEN.findall(line):
        if q or (not p and not a):
            out.append(q.replace(b'\\"', b'"').replace(b"\\\\", b"\\").decode("utf-8", "replace"))
        elif p:
            out.append("(" + p.decode() + ")")
        else:
            out.append(a.decode("utf-8", "replace"))
    return out


def in_set(spec, value, top):
    for part in spec.split(","):
        lo, _, hi = part.partition(":")
        lo = top if lo == "*" else int(lo)
        hi = lo if not hi else (top if hi == "*" else int(hi))
        if min(lo, hi) <= value <= max(lo, hi):
            return True
    return False


def quote(name):
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


class Imap:
    def __init__(self, reader, writer):
        self.r, self.w = reader, writer
        self.boxes = None
        self.sel = None

    def send(self, data):
        self.w.write(data if isinstance(data, bytes) else data.encode() + b"\r\n")

    async def read_command(self):
        line = await self.r.readline()
        if not line:
            return None
        literals = []
        while True:
            m = re.search(rb"\{(\d+)\+?\}\r?\n$", line)
            if not m:
                break
            self.send("+ Ready for literal data")
            await self.w.drain()
            literals.append(await self.r.readexactly(int(m.group(1))))
            line = line[: m.start()] + b'"\x00LIT' + str(len(literals) - 1).encode() + b'" ' + await self.r.readline()
        return line.rstrip(b"\r\n"), literals

    def pick(self, spec, by_uid):
        msgs = self.sel.msgs
        if not msgs:
            return []
        top = msgs[-1].uid if by_uid else len(msgs)
        return [(i + 1, m) for i, m in enumerate(msgs) if in_set(spec, m.uid if by_uid else i + 1, top)]

    def fetch(self, spec, items, by_uid):
        items = items.upper()
        for seq, m in self.pick(spec, by_uid):
            parts = [f"UID {m.uid}".encode()]
            if "FLAGS" in items:
                parts.append(f"FLAGS ({' '.join(sorted(m.flags))})".encode())
            if "RFC822.SIZE" in items:
                parts.append(f"RFC822.SIZE {len(m.raw)}".encode())
            if "INTERNALDATE" in items:
                parts.append(m.when.strftime('INTERNALDATE "%d-%b-%Y %H:%M:%S +0000"').encode())
            if "[HEADER]" in items:
                head = m.raw.split(b"\r\n\r\n", 1)[0] + b"\r\n\r\n"
                parts.append(b"BODY[HEADER] {%d}\r\n%s" % (len(head), head))
            if "BODY.PEEK[]" in items or "BODY[]" in items:
                parts.append(b"BODY[] {%d}\r\n%s" % (len(m.raw), m.raw))
                if "BODY[]" in items:
                    m.flags.add("\\Seen")
            self.send(b"* %d FETCH (%s)\r\n" % (seq, b" ".join(parts)))

    def expunge(self, wanted):
        seq = 1
        for m in list(self.sel.msgs):
            if wanted(m):
                self.sel.msgs.remove(m)
                self.send(f"* {seq} EXPUNGE")
            else:
                seq += 1

    def box(self, name):
        if name.upper() == "INBOX":
            name = "INBOX"
        return self.boxes.get(name)

    async def run(self):
        self.send("* OK MailStudio dev server ready")
        while True:
            await self.w.drain()
            cmd = await self.read_command()
            if cmd is None:
                return
            line, literals = cmd
            parts = tokens(line)
            if len(parts) < 2:
                self.send("* BAD empty command")
                continue
            tag, name, args = parts[0], parts[1].upper(), parts[2:]
            by_uid = name == "UID"
            if by_uid:
                name, args = args[0].upper(), args[1:]
            ok = lambda text="completed": self.send(f"{tag} OK {name} {text}")
            no = lambda text: self.send(f"{tag} NO {text}")
            try:
                if name == "CAPABILITY":
                    self.send("* CAPABILITY IMAP4rev1 MOVE UIDPLUS SPECIAL-USE")
                    ok()
                elif name == "NOOP":
                    ok()
                elif name == "LOGOUT":
                    self.send("* BYE bye")
                    ok()
                    await self.w.drain()
                    return
                elif name == "LOGIN":
                    self.boxes = STORE.user(args[0])
                    ok()
                elif self.boxes is None:
                    no("log in first")
                elif name == "LIST":
                    for n in sorted(self.boxes, key=lambda n: (n != "INBOX", n)):
                        attrs = "\\HasNoChildren" + (" " + SPECIAL[n] if n in SPECIAL else "")
                        self.send(f'* LIST ({attrs}) "/" {quote(n)}')
                    ok()
                elif name == "STATUS":
                    b = self.box(args[0])
                    if b is None:
                        no("no such mailbox")
                        continue
                    unseen = sum(1 for m in b.msgs if "\\Seen" not in m.flags)
                    self.send(f"* STATUS {quote(args[0])} (MESSAGES {len(b.msgs)} UNSEEN {unseen} UIDNEXT {b.uidnext} UIDVALIDITY {b.uidvalidity})")
                    ok()
                elif name in ("SELECT", "EXAMINE"):
                    b = self.box(args[0])
                    if b is None:
                        self.sel = None
                        no("no such mailbox")
                        continue
                    self.sel = b
                    self.send(f"* {len(b.msgs)} EXISTS")
                    self.send("* 0 RECENT")
                    self.send("* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)")
                    self.send("* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] ok")
                    self.send(f"* OK [UIDVALIDITY {b.uidvalidity}] ok")
                    self.send(f"* OK [UIDNEXT {b.uidnext}] ok")
                    self.send(f"{tag} OK [READ-WRITE] {name} completed")
                elif name == "CREATE":
                    if self.box(args[0]) is not None:
                        no("mailbox exists")
                    else:
                        self.boxes[args[0]] = Mailbox()
                        ok()
                elif name == "DELETE":
                    if args[0].upper() == "INBOX" or args[0] in SPECIAL or args[0] not in self.boxes:
                        no("cannot delete that mailbox")
                    else:
                        for n in [n for n in self.boxes if n == args[0] or n.startswith(args[0] + "/")]:
                            del self.boxes[n]
                        ok()
                elif name == "RENAME":
                    if args[0] not in self.boxes or args[1] in self.boxes:
                        no("cannot rename")
                    else:
                        for n in [n for n in self.boxes if n == args[0] or n.startswith(args[0] + "/")]:
                            self.boxes[args[1] + n[len(args[0]):]] = self.boxes.pop(n)
                        ok()
                elif name in ("SUBSCRIBE", "UNSUBSCRIBE", "CHECK"):
                    ok()
                elif name == "APPEND":
                    b = self.box(args[0])
                    if b is None:
                        no("[TRYCREATE] no such mailbox")
                        continue
                    flags = next((a[1:-1].split() for a in args[1:] if a.startswith("(")), [])
                    lit = next(a for a in args if a.startswith("\x00LIT"))
                    b.add(literals[int(lit[4:])], flags)
                    ok()
                elif self.sel is None:
                    no("select a mailbox first")
                elif name == "CLOSE":
                    self.sel = None
                    ok()
                elif name == "FETCH":
                    self.fetch(args[0], " ".join(args[1:]), by_uid)
                    ok()
                elif name == "SEARCH":
                    spec = args[args.index("UID") + 1] if "UID" in [a.upper() for a in args] else "1:*"
                    found = [str(m.uid if by_uid else seq) for seq, m in self.pick(spec, True)]
                    self.send("* SEARCH " + " ".join(found) if found else "* SEARCH")
                    ok()
                elif name == "STORE":
                    op, flags = args[1].upper(), args[2][1:-1].split()
                    for seq, m in self.pick(args[0], by_uid):
                        if op.startswith("+"):
                            m.flags.update(flags)
                        elif op.startswith("-"):
                            m.flags.difference_update(flags)
                        else:
                            m.flags = set(flags)
                        if "SILENT" not in op:
                            self.send(f"* {seq} FETCH (UID {m.uid} FLAGS ({' '.join(sorted(m.flags))}))")
                    ok()
                elif name in ("COPY", "MOVE"):
                    dest = self.box(args[1])
                    if dest is None:
                        no("[TRYCREATE] no such mailbox")
                        continue
                    picked = [m for _, m in self.pick(args[0], by_uid)]
                    for m in picked:
                        dest.add(m.raw, m.flags - {"\\Deleted"}, m.when)
                    if name == "MOVE":
                        self.expunge(lambda m: m in picked)
                    ok()
                elif name == "EXPUNGE":
                    if by_uid:
                        uids = {m.uid for _, m in self.pick(args[0], True)}
                        self.expunge(lambda m: m.uid in uids and "\\Deleted" in m.flags)
                    else:
                        self.expunge(lambda m: "\\Deleted" in m.flags)
                    ok()
                else:
                    self.send(f"{tag} BAD unknown command {name}")
            except (IndexError, ValueError, StopIteration) as e:
                self.send(f"{tag} BAD cannot parse the command: {e}")


async def imap_client(reader, writer):
    try:
        await Imap(reader, writer).run()
    except (ConnectionError, asyncio.IncompleteReadError):
        pass
    finally:
        writer.close()


# ---- SMTP ---------------------------------------------------------------------------------------


async def smtp_client(reader, writer):
    def send(text):
        writer.write(text.encode() + b"\r\n")

    rcpts = []
    try:
        send("220 mailstudio.test dev SMTP")
        while True:
            await writer.drain()
            line = await reader.readline()
            if not line:
                return
            text = line.decode("utf-8", "replace").strip()
            verb = text.split(" ", 1)[0].upper()
            if verb in ("EHLO", "HELO"):
                send("250-mailstudio.test\r\n250-8BITMIME\r\n250-SMTPUTF8\r\n250-SIZE 52428800\r\n250 AUTH PLAIN LOGIN")
            elif verb == "AUTH":
                if "LOGIN" in text.upper() and len(text.split()) == 2:
                    send("334 VXNlcm5hbWU6")
                    await writer.drain()
                    await reader.readline()
                    send("334 UGFzc3dvcmQ6")
                    await writer.drain()
                    await reader.readline()
                send("235 2.7.0 Authentication successful")
            elif verb == "MAIL":
                rcpts = []
                send("250 OK")
            elif verb == "RCPT":
                m = re.search(r"<([^>]+)>", text)
                if not m:
                    send("501 bad recipient")
                elif m.group(1).lower().endswith("@reject.test"):
                    send("550 5.1.1 No such user here")
                else:
                    rcpts.append(m.group(1))
                    send("250 OK")
            elif verb == "DATA":
                if not rcpts:
                    send("503 need RCPT first")
                    continue
                send("354 End data with <CR><LF>.<CR><LF>")
                await writer.drain()
                data = b""
                while True:
                    row = await reader.readline()
                    if row in (b".\r\n", b".\n", b""):
                        break
                    data += row[1:] if row.startswith(b"..") else row
                for r in rcpts:
                    STORE.deliver(r, data)
                print(f"smtp: delivered {len(data)} bytes to {', '.join(rcpts)}", flush=True)
                send("250 OK queued")
            elif verb in ("RSET", "NOOP"):
                send("250 OK")
            elif verb == "QUIT":
                send("221 bye")
                await writer.drain()
                return
            else:
                send("502 command not implemented")
    except ConnectionError:
        pass
    finally:
        writer.close()


async def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--imap", type=int, default=1143)
    ap.add_argument("--smtp", type=int, default=1025)
    a = ap.parse_args()
    seed()
    imap = await asyncio.start_server(imap_client, "127.0.0.1", a.imap)
    smtp = await asyncio.start_server(smtp_client, "127.0.0.1", a.smtp)
    print(f"IMAP on 127.0.0.1:{a.imap}, SMTP on 127.0.0.1:{a.smtp} (no encryption, any password)", flush=True)
    print("Sample mailboxes: demo@mailstudio.test, second@mailstudio.test", flush=True)
    async with imap, smtp:
        await asyncio.gather(imap.serve_forever(), smtp.serve_forever())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
