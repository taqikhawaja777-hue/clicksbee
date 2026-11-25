import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/access/permissions.guard';

export const CANDIDATE_STATUSES = ['NEW', 'INTERVIEW', 'HIRED', 'REJECTED'] as const;
const MAX_CV_BYTES = 5 * 1024 * 1024;
const CV_TYPES = /\.(pdf|doc|docx|png|jpe?g)$/i;

export class CandidateDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120)
  fullName: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  position?: string;

  @ApiPropertyOptional({ enum: CANDIDATE_STATUSES }) @IsOptional() @IsIn(CANDIDATE_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class UpdateCandidateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  position?: string;

  @ApiPropertyOptional({ enum: CANDIDATE_STATUSES }) @IsOptional() @IsIn(CANDIDATE_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

const LIST_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  position: true,
  status: true,
  notes: true,
  cvFileName: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Recruitment - HR and Admin/Boss only. The CV is stored in the database (Render's disk is wiped on deploy). */
@ApiTags('Candidates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('candidates.manage')
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly prisma: PrismaService) {}

  private async findOwn(req: any, id: string) {
    const candidate = /^[a-f0-9]{24}$/i.test(id)
      ? await this.prisma.candidate.findFirst({ where: { id, organizationId: req.user.organizationId }, select: { id: true } })
      : null;
    if (!candidate) throw new NotFoundException('Candidate not found');
    return candidate;
  }

  @ApiOperation({ summary: 'All candidates' })
  @Get()
  list(@Req() req: any) {
    return this.prisma.candidate.findMany({
      where: { organizationId: req.user.organizationId },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  @ApiOperation({ summary: 'Add a candidate' })
  @Post()
  create(@Req() req: any, @Body() dto: CandidateDto) {
    return this.prisma.candidate.create({
      data: {
        organizationId: req.user.organizationId,
        createdBy: req.user.id,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim().toLowerCase() || null,
        position: dto.position?.trim() || null,
        status: dto.status || 'NEW',
        notes: dto.notes?.trim() || null,
      },
      select: LIST_SELECT,
    });
  }

  @ApiOperation({ summary: 'Update a candidate' })
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCandidateDto) {
    await this.findOwn(req, id);
    return this.prisma.candidate.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
        ...(dto.position !== undefined ? { position: dto.position.trim() || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
      },
      select: LIST_SELECT,
    });
  }

  @ApiOperation({ summary: 'Delete a candidate' })
  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.findOwn(req, id);
    await this.prisma.candidate.delete({ where: { id } });
    return { deleted: true };
  }

  @ApiOperation({ summary: 'Attach / replace the CV (PDF, Word or image, max 5 MB)' })
  @ApiConsumes('multipart/form-data')
  @Post(':id/cv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CV_BYTES } }))
  async uploadCv(@Req() req: any, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    await this.findOwn(req, id);
    if (!file) throw new BadRequestException('file is required');
    if (!CV_TYPES.test(file.originalname)) throw new BadRequestException('CV must be a PDF, Word document or image');
    return this.prisma.candidate.update({
      where: { id },
      data: { cvFile: file.buffer, cvFileName: file.originalname, cvMimeType: file.mimetype || 'application/octet-stream' },
      select: LIST_SELECT,
    });
  }

  @ApiOperation({ summary: 'Download the CV' })
  @Get(':id/cv')
  async downloadCv(@Req() req: any, @Param('id') id: string) {
    await this.findOwn(req, id);
    const c = await this.prisma.candidate.findUnique({ where: { id }, select: { cvFile: true, cvFileName: true, cvMimeType: true } });
    if (!c?.cvFile || !c.cvFileName) throw new NotFoundException('No CV uploaded');
    const buffer = Buffer.from(c.cvFile);
    const ascii = c.cvFileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
    return new StreamableFile(buffer, {
      type: c.cvMimeType || 'application/octet-stream',
      disposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(c.cvFileName)}`,
      length: buffer.length,
    });
  }
}
