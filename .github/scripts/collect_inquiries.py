# アプリの「問い合わせ」で送られたものを、GitHub の Issue にする（GitHub Actions で5分ごとに実行）。
# アプリは問い合わせを中継サーバー（対戦と同じ MQTT の公開サーバー）に「残すメッセージ（retain）」として置く。
# ここではつないだまま約4分半待ち、届いたもの（前から残っていたもの・新しく届いたもの）をすぐ Issue にして、中継サーバーから消す。
# 5分ごとの実行とつなげて、送ってから1分くらいで Issue になる。送る人は GitHub のアカウントが要らない。
import json, queue, subprocess, time
import paho.mqtt.client as mqtt

BASE = 'ygo-practice-sora20051003/v1'
TOPIC = BASE + '/inq/+'
BROKERS = [('broker.emqx.io', 1883), ('broker.hivemq.com', 1883)]
RUN_SECONDS = 270   # 1回の実行でつないでおく時間（次の実行の前に終わるように）

inbox = queue.Queue()
done_ids = set()


def gh(*args):
    return subprocess.run(['gh', *args], capture_output=True, text=True)


def already(inq_id):
    r = gh('issue', 'list', '--state', 'all', '--search', f'"inq-id: {inq_id}" in:body', '--json', 'number', '--limit', '5')
    try:
        return len(json.loads(r.stdout or '[]')) > 0
    except Exception:
        return False


def connect(host, port):
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'ygo-inq-{host[:6]}-{int(time.time())}')
    def on_connect(cl, userdata, flags, rc, props=None):
        cl.subscribe(TOPIC, qos=1)
    def on_message(cl, userdata, msg):
        if msg.payload:
            inbox.put((cl, msg.topic, msg.payload))
    c.on_connect = on_connect
    c.on_message = on_message
    try:
        c.connect(host, port, keepalive=60)
        c.loop_start()
        return c
    except Exception as e:
        print('つながりません', host, e)
        return None


def handle(c, topic, payload):
    try:
        m = json.loads(payload.decode('utf-8'))
        inq_id = str(m.get('id', ''))[:40]
        title = str(m.get('title', '問い合わせ'))[:120].replace('\n', ' ')
        body = str(m.get('body', ''))[:20000]
    except Exception as e:
        print('読めない問い合わせ', topic, e)
        c.publish(topic, b'', qos=1, retain=True)
        return
    if not inq_id:
        c.publish(topic, b'', qos=1, retain=True)
        return
    # 2つのサーバーの両方に置かれていることがあるので、同じものは1回だけ Issue にする
    if inq_id not in done_ids and not already(inq_id):
        body += f'\n\n<!-- inq-id: {inq_id} -->\ninq-id: {inq_id}（アプリから送られた問い合わせ）'
        r = gh('issue', 'create', '--title', title, '--body', body, '--label', '問い合わせ')
        if r.returncode != 0:
            print('Issue を作れませんでした', r.stderr)
            return   # 消さずに次の回にもう一度
        print('Issue を作りました', r.stdout.strip(), flush=True)
    done_ids.add(inq_id)
    c.publish(topic, b'', qos=1, retain=True)   # Issue にしたものは中継サーバーから消す


def main():
    clients = [c for c in (connect(h, p) for h, p in BROKERS) if c]
    end = time.time() + RUN_SECONDS
    while time.time() < end:
        try:
            c, topic, payload = inbox.get(timeout=2)
        except queue.Empty:
            continue
        handle(c, topic, payload)
    time.sleep(2)
    for c in clients:
        c.loop_stop()
        c.disconnect()
    print('この回に Issue にした問い合わせ', len(done_ids), '件')


main()
