import { BadRequestException } from '@nestjs/common';
import { decodeImage, IdleReportsService, pickImageIndexes, summariseEpisode } from './idle-reports.service';

// 2026-11-13 15:44 Asia/Karachi (inside shift, not a break)
const NOW = new Date('2026-11-13T10:44:00.000Z');
const IDLE_SINCE = '2026-11-13T10:42:00.000Z';
const JPEG = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;
const EMPLOYEE = { id: 'u1', organizationId: 'org', role: 'EMPLOYEE', designation: 'Employee', officeCategory: null };

function setup(lastCaptureAt: Date | null = null) {
  const prisma: any = {
    idleEpisode: { upsert: jest.fn(async () => ({ id: 'ep1' })) },
    idleCapture: {
      findFirst: jest.fn(async () => (lastCaptureAt ? { capturedAt: lastCaptureAt } : null)),
      create: jest.fn(async () => ({ id: 'cap1' })),
      update: jest.fn(async () => ({})),
    },
  };
  const monitor: any = {
    analyzeScreenshot: jest.fn(async () => ({ success: true, data: { summary: 'YouTube video playing in Chrome' } })),
  };
  return { service: new IdleReportsService(prisma, monitor), prisma, monitor };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('IdleReportsService', () => {
  it('stores the capture and saves the Live Monitor AI summary on it', async () => {
    const { service, prisma, monitor } = setup();
    const res = await service.recordCapture(EMPLOYEE, { idleSince: IDLE_SINCE, screenshot: JPEG, camera: JPEG, cameraStatus: 'AWAY' }, NOW);
    expect(res).toEqual({ recorded: true, captureId: 'cap1' });
    expect(prisma.idleEpisode.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_idleSince: { userId: 'u1', idleSince: new Date(IDLE_SINCE) } } }),
    );
    const data = prisma.idleCapture.create.mock.calls[0][0].data;
    expect(data.cameraStatus).toBe('AWAY');
    expect(Buffer.isBuffer(data.screenshot) && Buffer.isBuffer(data.camera)).toBe(true);

    await flush();
    expect(monitor.analyzeScreenshot).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 'u1', persist: false }));
    expect(prisma.idleCapture.update).toHaveBeenCalledWith({ where: { id: 'cap1' }, data: { summary: 'YouTube video playing in Chrome' } });
  });

  it('keeps no camera picture when camera presence is off', async () => {
    const { service, prisma } = setup();
    await service.recordCapture(EMPLOYEE, { idleSince: IDLE_SINCE, screenshot: JPEG, camera: JPEG, cameraStatus: 'OFF' }, NOW);
    expect(prisma.idleCapture.create.mock.calls[0][0].data).toMatchObject({ camera: null, cameraStatus: 'OFF' });
  });

  it('records nothing during a break or off shift (except flexible-hours roles)', async () => {
    const { service, prisma } = setup();
    const breakTime = new Date('2026-11-13T09:30:00.000Z'); // 14:30 Karachi - the 2-3 PM break
    const res = await service.recordCapture(EMPLOYEE, { idleSince: '2026-11-13T09:28:00.000Z', screenshot: JPEG, cameraStatus: 'OFF' }, breakTime);
    expect(res.recorded).toBe(false);
    expect(prisma.idleCapture.create).not.toHaveBeenCalled();

    const night = new Date('2026-11-13T17:00:00.000Z'); // 22:00 Karachi
    const backOffice = { ...EMPLOYEE, officeCategory: 'BACK_OFFICE' };
    const ok = await service.recordCapture(backOffice, { idleSince: '2026-11-13T16:58:00.000Z', screenshot: JPEG, cameraStatus: 'OFF' }, night);
    expect(ok.recorded).toBe(true);
  });

  it('ignores a capture sent less than 40 s after the previous one', async () => {
    const { service, prisma } = setup(new Date(NOW.getTime() - 20_000));
    const res = await service.recordCapture(EMPLOYEE, { idleSince: IDLE_SINCE, screenshot: JPEG, cameraStatus: 'OFF' }, NOW);
    expect(res).toEqual({ recorded: false, reason: 'Duplicate' });
    expect(prisma.idleCapture.create).not.toHaveBeenCalled();
  });

  it('rejects bad images and stale timestamps', async () => {
    const { service } = setup();
    await expect(service.recordCapture(EMPLOYEE, { idleSince: IDLE_SINCE, screenshot: 'not-an-image', cameraStatus: 'OFF' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordCapture(EMPLOYEE, { idleSince: '2026-11-12T10:00:00.000Z', screenshot: JPEG, cameraStatus: 'OFF' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('after an idle period ends, keeps pictures only for the first/middle/last captures', async () => {
    const captures = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }));
    const prisma: any = {
      idleEpisode: {
        findMany: jest.fn(async () => [{ id: 'ep1', captures }]),
        update: jest.fn(async () => ({})),
      },
      idleCapture: { updateMany: jest.fn(async () => ({ count: 2 })) },
    };
    const service = new IdleReportsService(prisma, {} as any);
    expect(await service.pruneImages(NOW)).toBe(1);
    expect(prisma.idleCapture.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c3'] } },
      data: { screenshot: null, camera: null },
    });
    expect(prisma.idleEpisode.update).toHaveBeenCalledWith({ where: { id: 'ep1' }, data: { imagesPruned: true } });
  });

  it('helpers: decode limits, first/middle/last picks, one-line summary', () => {
    expect(decodeImage(JPEG, 1000)).toBeInstanceOf(Buffer);
    expect(decodeImage(JPEG, 3)).toBeNull();
    expect(decodeImage('data:text/html;base64,AAAA', 1000)).toBeNull();

    expect(pickImageIndexes(2)).toEqual([0, 1]);
    expect(pickImageIndexes(10)).toEqual([0, 5, 9]);

    expect(
      summariseEpisode([
        { summary: 'CRM open, no activity', cameraStatus: 'PRESENT' },
        { summary: 'CRM open, no activity', cameraStatus: 'AWAY' },
        { summary: 'YouTube playing', cameraStatus: 'AWAY' },
      ]),
    ).toBe('CRM open, no activity Then: YouTube playing Camera: at the desk in 1 and away in 2 of 3 checks.');
    expect(summariseEpisode([{ summary: null, cameraStatus: 'OFF' }])).toBe('No AI summary available. Camera presence was not active.');
  });
});
