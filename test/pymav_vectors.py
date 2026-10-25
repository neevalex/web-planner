"""Cross-check helper against pymavlink (ardupilotmega dialect).

  python3 test/pymav_vectors.py gen          -> prints JSON test vectors (hex frames + expected fields)
  python3 test/pymav_vectors.py check <hex>  -> decodes concatenated frames, prints JSON list
"""
import json
import os
import sys

os.environ['MAVLINK20'] = '1'
from pymavlink.dialects.v20 import ardupilotmega as mav  # noqa: E402


class Sink:
    def write(self, b):
        pass


def conv(v):
    if isinstance(v, bytes):
        return v.decode('ascii', 'replace').rstrip('\x00')
    if isinstance(v, (list, tuple)):
        return [conv(x) for x in v]
    if isinstance(v, int) and abs(v) > 2**53:
        return str(v)
    if isinstance(v, float) and v != v:
        return 'NaN'
    return v


def to_fields(msg):
    return {name: conv(getattr(msg, name)) for name in msg.get_fieldnames()}


def gen():
    m = mav.MAVLink(Sink(), srcSystem=1, srcComponent=1)
    msgs = [
        m.heartbeat_encode(2, 3, 217, 4, 3, 3),
        m.global_position_int_encode(123456, 505012345, 304567890, 180000, 12000, -150, 230, -5, 27000),
        m.param_value_encode(b'ATC_RAT_RLL_P', 0.135, 9, 1234, 56),
        m.statustext_encode(4, b'PreArm: Need 3D Fix', 7, 2),  # has extensions
        m.attitude_encode(1000, 0.1, -0.2, 3.0, 0.01, 0.0, -0.01),
        m.sys_status_encode(1, 2, 3, 500, 11800, -1, 87, 0, 0, 0, 0, 0, 0),
        m.gps_raw_int_encode(1234567890123, 3, 505012345, 304567890, 180000, 120, 200, 500, 9000, 14,
                             181000, 1000, 2000, 300, 400, 0),  # uint64 + extensions
        m.command_long_encode(1, 1, 400, 0, 1, 21196, 0, 0, 0, 0, 0),
        m.servo_output_raw_encode(5000, 0, *range(1000, 1016)),  # extensions
        m.mission_item_int_encode(1, 1, 3, 3, 16, 0, 1, 0.0, 2.0, 0.0, float('nan'), 505000000, 304000000, 50.0, 0),
    ]
    out = []
    for i, msg in enumerate(msgs):
        buf = msg.pack(m)
        m.seq = (m.seq + 1) % 256
        out.append({'name': msg.get_type(), 'hex': bytes(buf).hex(), 'fields': to_fields(msg)})
    print(json.dumps(out))


def check(hexstr):
    m = mav.MAVLink(Sink())
    m.robust_parsing = False
    res = []
    for msg in m.parse_buffer(bytes.fromhex(hexstr)) or []:
        res.append({'name': msg.get_type(), 'fields': to_fields(msg)})
    print(json.dumps(res))


if __name__ == '__main__':
    if sys.argv[1] == 'gen':
        gen()
    else:
        check(sys.argv[2])
