# アプリの「問い合わせ」で送られたものを、GitHub の Issue にする（GitHub Actions で15分ごとに実行）。
# アプリは問い合わせを中継サーバー（対戦と同じ MQTT の公開サーバー）に「残すメッセージ（retain）」として置く。
# ここではそれを受け取り、まだ Issue になっていなければ Issue を作り、中継サーバーから消す。
# 送る人は GitHub のアカウントが要らない。
import json, subprocess, sys, time
import paho.mqtt.client as mqtt

BASE = 'ygo-practice-sora20051003/v1'
TOPIC = BASE + '/inq/+'
BROKERS = [('broker.emqx.io', 1883), ('broker.hivemq.com', 1883)]
WAIT = 10   # 残っているメッセージが届くのを待つ秒数


def collect(host, port):
    got = {}
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='ygo-inq-' + str(int(time.time())))
    def on_connect(cl, userdata, flags, rc, props=None):
        cl.subscribe(TOPIC, qos=1)
    def on_message(cl, userdata, msg):
        if msg.payload:
            got[msg.topic] = msg.payload
    c.on_connect = on_connect
    c.on_message = on_message
    try:
        c.connect(host, port, keepalive=30)
    except Exception as e:
        print('つながりません', host, e)
        return c, {}
    c.loop_start()
    time.sleep(WAIT)
    return c, got


def gh(*args):
    return subprocess.run(['gh', *args], capture_output=True, text=True)


def already(inq_id):
    r = gh('issue', 'list', '--state', 'all', '--search', f'"inq-id: {inq_id}" in:body', '--json', 'number', '--limit', '5')
    try:
        return len(json.loads(r.stdout or '[]')) > 0
    except Exception:
        return False


def main():
    made = 0
    for host, port in BROKERS:
        c, got = collect(host, port)
        for topic, payload in got.items():
            try:
                m = json.loads(payload.decode('utf-8'))
                inq_id = str(m.get('id', ''))[:40]
                title = str(m.get('title', '問い合わせ'))[:120].replace('\n', ' ')
                body = str(m.get('body', ''))[:20000]
            except Exception as e:
                print('読めない問い合わせ', topic, e)
                c.publish(topic, b'', qos=1, retain=True)
                continue
            if not inq_id:
                c.publish(topic, b'', qos=1, retain=True)
                continue
            if not already(inq_id):
                body += f'\n\n<!-- inq-id: {inq_id} -->\ninq-id: {inq_id}（アプリから送られた問い合わせ）'
                r = gh('issue', 'create', '--title', title, '--body', body, '--label', '問い合わせ')
                if r.returncode != 0:
                    print('Issue を作れませんでした', r.stderr)
                    continue   # 消さずに次の回にもう一度
                made += 1
                print('Issue を作りました', r.stdout.strip())
            c.publish(topic, b'', qos=1, retain=True)   # Issue にしたものは中継サーバーから消す
        time.sleep(2)
        c.loop_stop()
        c.disconnect()
    print('新しい問い合わせ', made, '件')


main()
