from __future__ import annotations

import struct
from dataclasses import dataclass

from services.tgnet.models.datacenter import Datacenter
from services.tgnet.models.headers import Headers
from services.tgnet.native_byte_buffer import NativeByteBuffer


@dataclass
class TGAndroidSession:
    headers: Headers
    datacenters: list[Datacenter]

    @classmethod
    def deserialize(cls, buffer: NativeByteBuffer) -> TGAndroidSession:
        headers = Headers.deserialize(buffer)
        datacenters = []

        numOfDatacenters = buffer.readUint32()
        for i in range(numOfDatacenters):
            datacenters.append(Datacenter.deserialize(buffer))

        return cls(headers, datacenters)

    def serialize(self, buffer: NativeByteBuffer) -> None:
        self.headers.serialize(buffer)
        buffer.writeUint32(len(self.datacenters))

        for dc in self.datacenters:
            dc.serialize(buffer)

        val = buffer.buffer.getvalue()
        if len(val) >= 4:
            payload_len = len(val) - 4
            buffer.buffer.seek(0)
            buffer.buffer.write(struct.pack('<I', payload_len))
            buffer.buffer.seek(0, 2)
