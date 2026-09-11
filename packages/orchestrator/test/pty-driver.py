"""Disposable PTY driver for stub-only CLI assurance; never runs real vendors."""
import errno
import fcntl
import json
import os
import select
import signal
import sys
import termios
import time

request = json.loads(sys.stdin.read())
master, slave = os.openpty()
before = termios.tcgetattr(slave)
read_state, write_state = os.pipe()
pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    for fd in (0, 1, 2):
        os.dup2(slave, fd)
    if slave > 2:
        os.close(slave)
    os.close(read_state)
    client = os.fork()
    if client == 0:
        os.close(write_state)
        os.chdir(request["cwd"])
        os.execve(request["argv"][0], request["argv"], request["env"])
    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, lambda value, frame: os.kill(client, value))
    _, child_status = os.waitpid(client, 0)
    after = termios.tcgetattr(0)
    os.write(write_state, json.dumps({"exitCode": os.waitstatus_to_exitcode(child_status),
                                    "terminalRestored": (before[3] & (termios.ECHO | termios.ICANON)) == (after[3] & (termios.ECHO | termios.ICANON))}).encode())
    os._exit(0)
os.close(write_state)

output = b""
offset = 0
step = 0
status = None
deadline = time.monotonic() + request.get("timeout", 20)
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                output += os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
        if step < len(request["actions"]):
            action = request["actions"][step]
            target = action["wait"].encode()
            found = output.find(target, offset)
            if found >= 0:
                offset = found + len(target)
                if "send" in action:
                    os.write(master, action["send"].encode())
                if "signal" in action:
                    os.kill(pid, getattr(signal, action["signal"]))
                step += 1
        exited, result = os.waitpid(pid, os.WNOHANG)
        if exited:
            status = result
            break
    if status is None:
        os.killpg(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
        raise RuntimeError("PTY timeout at step %s: %s" % (step, output.decode(errors="replace")[-3000:]))
    final = json.loads(os.read(read_state, 4096))
    print(json.dumps({**final, "output": output.decode(errors="replace"), "steps": step}))
finally:
    os.close(master)
    os.close(slave)
