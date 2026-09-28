import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import FilterBar from '../components/common/FilterBar';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHerbFilter } from '../hooks/useHerbFilter';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { HERB_ORIGINS, HERB_PARTS } from '../types/herb-material';
import { FIRE_LEVELS, type FireLevel } from '../types/processing-method';
import { PROCESS_DEGREES, type ProcessBatch, type ProcessDegree } from '../types/process-batch';
import { DEGREE_RULES, judgeDegree, suggestedValues } from '../utils/degree';
import { buildStockMap, formatKg, STOCK_EPS, StockOverflowError } from '../utils/stock';

const { Title, Paragraph, Text } = Typography;

interface BatchFormValues {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  outputKg: number;
  fireLevel: FireLevel;
  temp: number;
  duration: number;
  startedAt: Dayjs;
  endedAt: Dayjs;
  operator: string;
  degree: ProcessDegree;
  remark?: string;
}

const DEGREE_COLOR: Record<ProcessDegree, string> = { 不及: 'orange', 适中: 'green', 太过: 'red' };

/** 工序记录台：选方法自动带出辅料比例、火候与判断标准，录入火候与得率 */
export default function BatchBoard() {
  const { message } = AntApp.useApp();
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const createBatch = useBatchStore((s) => s.createBatch);
  const updateBatch = useBatchStore((s) => s.updateBatch);
  const lockBatch = useBatchStore((s) => s.lockBatch);
  const unlockAsQc = useBatchStore((s) => s.unlockAsQc);
  const removeBatch = useBatchStore((s) => s.removeBatch);

  const herbFilter = useHerbFilter();
  const [params] = useSearchParams();
  const degreeParam = params.get('degree') ?? '';

  const [form] = Form.useForm<BatchFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessBatch | null>(null);
  const [qcMode, setQcMode] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const watched = Form.useWatch([], form) as Partial<BatchFormValues> | undefined;
  const watchedMethod = methods.find((m) => m.id === (watched?.methodId ?? ''));
  const watchedHerb = herbs.find((h) => h.id === (watched?.herbId ?? ''));
  const watchedYieldRate = useMemo(() => {
    const feed = Number(watched?.feedKg) || 0;
    const out = Number(watched?.outputKg) || 0;
    if (feed <= 0) return 0;
    return Number(((out / feed) * 100).toFixed(1));
  }, [watched?.feedKg, watched?.outputKg]);

  const verdict = useMemo(() => {
    if (!watchedMethod) return undefined;
    return judgeDegree({
      method: watchedMethod,
      fireLevel: (watched?.fireLevel ?? watchedMethod.fireLevel) as FireLevel,
      duration: Number(watched?.duration) || watchedMethod.duration,
      temp: Number(watched?.temp) || Math.round((watchedMethod.tempRange[0] + watchedMethod.tempRange[1]) / 2),
      yieldRate: watchedYieldRate,
    });
  }, [watchedMethod, watched?.fireLevel, watched?.duration, watched?.temp, watchedYieldRate]);

  const visibleHerbs = useMemo(() => herbFilter.apply(herbs), [herbs, herbFilter]);

  /** 药材批次余量（锁定与未锁定工序都占用，未锁定记录改动/撤销后自动重算） */
  const stockMap = useMemo(() => buildStockMap(herbs, batches), [herbs, batches]);
  /** 新增工序只列还有余量的批次；编辑时保留当前批次本身 */
  const herbOptions = useMemo(
    () =>
      herbs.filter((h) => {
        if (editing && h.id === editing.herbId) return true;
        return (stockMap.get(h.id)?.remainingKg ?? 0) > STOCK_EPS;
      }),
    [herbs, stockMap, editing],
  );
  const availableHerbs = useMemo(() => herbs.filter((h) => (stockMap.get(h.id)?.remainingKg ?? 0) > STOCK_EPS), [herbs, stockMap]);

  /** 当前表单所选批次本次还能投多少（编辑时加回自身投料） */
  const availableFor = (herbId: string | undefined): number => {
    if (!herbId) return 0;
    const stock = stockMap.get(herbId);
    if (!stock) return 0;
    if (editing && herbId === editing.herbId) {
      return Math.max(0, stock.remainingKg + editing.feedKg);
    }
    return Math.max(0, stock.remainingKg);
  };

  const watchedAvailable = availableFor(watched?.herbId);

  const visibleBatches = useMemo(() => {
    const ids = new Set(visibleHerbs.map((h) => h.id));
    return batches.filter((b) => {
      if (!ids.has(b.herbId)) return false;
      if (degreeParam && b.degree !== degreeParam) return false;
      return true;
    });
  }, [batches, visibleHerbs, degreeParam]);

  const methodOf = (id: string) => methods.find((m) => m.id === id);

  const openCreate = () => {
    setEditing(null);
    setQcMode(false);
    form.resetFields();
    const firstHerb = availableHerbs[0];
    const firstMethod = methods[0];
    const now = dayjs();
    const defaultFeed = firstHerb ? Math.max(0, stockMap.get(firstHerb.id)?.remainingKg ?? firstHerb.feedKg) : 100;
    const base: Partial<BatchFormValues> = {
      batchNo: `PZ-${dayjs().format('YYMMDD')}-${String(batches.length + 1).padStart(2, '0')}`,
      herbId: firstHerb?.id,
      methodId: firstMethod?.id,
      feedKg: Number(defaultFeed.toFixed(3)),
      outputKg: Number((defaultFeed * 0.94).toFixed(1)),
      auxUsedKg: Number(((defaultFeed * (firstMethod?.auxRatio ?? 0)) / 100).toFixed(2)),
      fireLevel: firstMethod?.fireLevel ?? '文火',
      temp: firstMethod ? Math.round((firstMethod.tempRange[0] + firstMethod.tempRange[1]) / 2) : 100,
      duration: firstMethod?.duration ?? 12,
      startedAt: now.subtract(20, 'minute'),
      endedAt: now,
      operator: '陈玉兰',
      degree: '适中',
    };
    form.setFieldsValue(base as unknown as BatchFormValues);
    setOpen(true);
  };

  const openEdit = (record: ProcessBatch) => {
    setEditing(record);
    setQcMode(false);
    form.resetFields();
    const suggested = methodOf(record.methodId);
    form.setFieldsValue({
      batchNo: record.batchNo,
      herbId: record.herbId,
      methodId: record.methodId,
      feedKg: record.feedKg,
      auxUsedKg: record.auxUsedKg,
      outputKg: Number(((record.feedKg * record.yieldRate) / 100).toFixed(1)),
      fireLevel: record.fireLevel,
      temp: suggested ? Math.round((suggested.tempRange[0] + suggested.tempRange[1]) / 2) : 100,
      duration: suggested?.duration ?? 12,
      startedAt: dayjs(record.startedAt),
      endedAt: dayjs(record.endedAt),
      operator: record.operator,
      degree: record.degree,
      remark: record.remark,
    } as unknown as BatchFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const outputKg = Number(values.outputKg) || 0;
    const feedKg = Number(values.feedKg) || 0;
    if (feedKg <= 0) {
      message.error('投料量必须大于 0');
      return;
    }
    // 超出余量直接拦住保存，并提示该批次本次可投数量
    const available = availableFor(values.herbId);
    if (feedKg > available + STOCK_EPS) {
      message.error(`投料量超出余量：该批次本次最多可投 ${formatKg(available)}kg，请调整投料量或改用其他批次`);
      return;
    }
    const yieldRate = Number(((outputKg / feedKg) * 100).toFixed(1));
    const payload = {
      batchNo: values.batchNo,
      herbId: values.herbId,
      methodId: values.methodId,
      feedKg,
      auxUsedKg: Number(values.auxUsedKg) || 0,
      fireLevel: values.fireLevel,
      startedAt: values.startedAt.toISOString(),
      endedAt: values.endedAt.toISOString(),
      yieldRate,
      degree: values.degree,
      operator: values.operator,
      remark: values.remark,
    };
    try {
      if (editing) {
        const ok = await updateBatch(editing.id, payload, qcMode);
        if (!ok) {
          message.error('该批已锁定，请打开「质检员改判」后再提交');
          return;
        }
        if (qcMode && editing.locked) {
          await unlockAsQc(editing.id, '质检员 · 赵敏');
        }
        message.success(`已更新 ${payload.batchNo}，得率 ${yieldRate}%，余量已重算`);
      } else {
        await createBatch(payload, true);
        message.success(`已提交 ${payload.batchNo}，得率 ${yieldRate}%，该批已锁定并核销药材余量`);
      }
    } catch (error) {
      if (error instanceof StockOverflowError) {
        message.error(`投料量超出余量：${error.message}`);
        return;
      }
      throw error;
    }
    setOpen(false);
  };

  const columns: TableColumnsType<ProcessBatch> = [
    { title: '生产批号', dataIndex: 'batchNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '药材',
      dataIndex: 'herbId',
      width: 130,
      render: (id: string) => {
        const herb = herbs.find((h) => h.id === id);
        if (!herb) return '未知药材';
        const remaining = Math.max(0, stockMap.get(id)?.remainingKg ?? 0);
        return (
          <Space direction="vertical" size={0}>
            <Text>{herb.name}</Text>
            <Text type={remaining <= STOCK_EPS ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              余 {formatKg(remaining)}kg{remaining <= STOCK_EPS ? ' · 已用完' : ''}
            </Text>
          </Space>
        );
      },
    },
    { title: '方法', dataIndex: 'methodId', width: 90, render: (id: string) => methodOf(id)?.name ?? '-' },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 180,
      render: (v: FireLevel, record) => <FireLevelTag level={v} tempRange={methodOf(record.methodId)?.tempRange} duration={methodOf(record.methodId)?.duration} />,
    },
    { title: '投料(kg)', dataIndex: 'feedKg', width: 90, align: 'right' },
    { title: '辅料(kg)', dataIndex: 'auxUsedKg', width: 90, align: 'right' },
    { title: '得率(%)', dataIndex: 'yieldRate', width: 90, align: 'right', render: (v: number) => <Text type={v < 85 ? 'danger' : undefined}>{v}</Text> },
    { title: '程度', dataIndex: 'degree', width: 90, render: (v: ProcessDegree) => <Tag color={DEGREE_COLOR[v]}>{v}</Tag> },
    {
      title: '状态',
      dataIndex: 'locked',
      width: 100,
      render: (locked: boolean, record) =>
        locked ? <Tag color="blue">已锁定{record.qcBy ? ` · ${record.qcBy}` : ''}</Tag> : <Tag>待判定</Tag>,
    },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    {
      title: '操作',
      width: 230,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            {record.locked ? '质检改判' : '编辑'}
          </Button>
          {!record.locked ? (
            <Button size="small" type="link" onClick={() => lockBatch(record.id).then(() => message.success('已锁定该批'))}>
              锁定
            </Button>
          ) : (
            <Button size="small" type="link" onClick={() => unlockAsQc(record.id, '质检员 · 赵敏').then(() => message.success('质检员已放行，可重新编辑'))}>
              放行
            </Button>
          )}
          {!record.locked ? (
            <Popconfirm
              title={`确认撤销 ${record.batchNo}？`}
              description="撤销后对应药材批次余量将自动加回"
              onConfirm={async () => {
                const ok = await removeBatch(record.id);
                if (ok) {
                  message.success('已撤销，余量已重算');
                } else {
                  message.error('锁定记录继续占用余量，需先放行解锁');
                }
              }}
            >
              <Button size="small" type="link" danger>
                撤销
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        选择方法即带出辅料比例、火候与判断标准；每条工序按投料量核销对应药材批次余量（锁定记录继续占用，未锁定记录改动或撤销后余量自动重算），余量清零的批次不可再选。
      </Paragraph>

      <Space style={{ marginBottom: 12 }} wrap>
        <Button type="primary" onClick={openCreate}>
          新建工序记录
        </Button>
        <Button onClick={() => setShowRules((v) => !v)}>{showRules ? '收起程度判定规则' : '查看程度判定规则'}</Button>
      </Space>

      {availableHerbs.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="所有药材批次余量均已用完"
          description="无法新建工序，请先到药材台账登记新的药材批次。"
        />
      ) : null}

      {showRules ? (
        <Card size="small" style={{ marginBottom: 12 }} title="炮制程度判定规则">
          <Table
            rowKey="degree"
            size="small"
            pagination={false}
            dataSource={DEGREE_RULES}
            columns={[
              { title: '程度', dataIndex: 'degree', width: 90, render: (v: ProcessDegree) => <Tag color={DEGREE_COLOR[v]}>{v}</Tag> },
              { title: '判定条件', dataIndex: 'condition' },
              { title: '处置', dataIndex: 'action', width: 280 },
            ]}
          />
        </Card>
      ) : null}

      <FilterBar
        fields={[
          { key: 'origin', label: '基原', options: HERB_ORIGINS, width: 110 },
          { key: 'part', label: '药用部位', options: HERB_PARTS, width: 110 },
          { key: 'degree', label: '程度', options: PROCESS_DEGREES, width: 110 },
        ]}
        resultCount={visibleBatches.length}
        totalCount={batches.length}
        keywordPlaceholder="搜索药材名 / 批号"
      />

      {visibleBatches.length === 0 ? (
        <EmptyPanel description="没有符合条件的工序记录" actionText="新建一条工序记录" onAction={openCreate} />
      ) : (
        <Table rowKey="id" size="small" columns={columns} dataSource={visibleBatches} pagination={{ pageSize: 10 }} scroll={{ x: 1400 }} />
      )}

      <Modal
        open={open}
        title={editing ? `工序记录 · ${editing.batchNo}` : '新建炮制工序记录'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText={editing ? '保存' : '提交并锁定该批'}
        cancelText="取消"
        width={760}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if ('herbId' in changed) {
              // 换药材批次：投料量不超过该批次余量，并按当前方法重算辅料与预计产出
              const available = availableFor(changed.herbId);
              const currentFeed = Number(form.getFieldValue('feedKg')) || 0;
              const feed = currentFeed > available + STOCK_EPS || currentFeed <= 0 ? Number(available.toFixed(3)) : currentFeed;
              const method = methods.find((m) => m.id === form.getFieldValue('methodId'));
              form.setFieldsValue(
                {
                  feedKg: feed,
                  auxUsedKg: method ? Number(((feed * method.auxRatio) / 100).toFixed(2)) : undefined,
                  outputKg: method ? Number((feed * (method.name === '蜜炙' ? 1.08 : 0.94)).toFixed(1)) : undefined,
                } as unknown as BatchFormValues,
              );
              form.validateFields(['feedKg']).catch(() => undefined);
            }
            if ('methodId' in changed) {
              const method = methods.find((m) => m.id === changed.methodId);
              if (method) {
                const suggestion = suggestedValues(method);
                const feed = Number(form.getFieldValue('feedKg')) || 0;
                form.setFieldsValue({
                  fireLevel: method.fireLevel,
                  temp: suggestion.temp,
                  duration: suggestion.duration,
                  auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                } as unknown as BatchFormValues);
              }
            }
            if ('feedKg' in changed) {
              const method = methods.find((m) => m.id === form.getFieldValue('methodId'));
              if (method) {
                const feed = Number(changed.feedKg) || 0;
                form.setFieldsValue({
                  auxUsedKg: Number(((feed * method.auxRatio) / 100).toFixed(2)),
                  outputKg: Number((feed * (method.name === '蜜炙' ? 1.08 : 0.94)).toFixed(1)),
                } as unknown as BatchFormValues);
              }
            }
            if (verdict && ('temp' in changed || 'duration' in changed || 'outputKg' in changed)) {
              form.setFieldsValue({ degree: verdict.degree } as unknown as BatchFormValues);
            }
          }}
        >
          {editing?.locked ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="该批得率与程度已锁定，仅质检员可改"
              action={<Switch checkedChildren="质检员改判" unCheckedChildren="只读" checked={qcMode} onChange={setQcMode} />}
            />
          ) : null}

          <Form.Item name="batchNo" label="生产批号" rules={[{ required: true, message: '请输入生产批号' }]}>
            <Input maxLength={24} disabled={Boolean(editing?.locked) && !qcMode} />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="herbId" label="药材批次" rules={[{ required: true, message: '请选择药材' }]} style={{ flex: 1 }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={availableHerbs.length === 0 ? '药材批次均已用完，请先登记' : '只列出还有余量的批次'}
                disabled={Boolean(editing?.locked) && !qcMode}
                options={herbOptions.map((h) => {
                  const remaining = Math.max(0, stockMap.get(h.id)?.remainingKg ?? 0);
                  const exhausted = remaining <= STOCK_EPS;
                  return {
                    value: h.id,
                    label: `${h.name} · ${h.batchNo}（余量 ${formatKg(remaining)}/${formatKg(h.feedKg)}kg${exhausted ? ' · 已用完' : ''}）`,
                  };
                })}
              />
            </Form.Item>
            <Form.Item name="methodId" label="炮制方法" rules={[{ required: true, message: '请选择炮制方法' }]} style={{ flex: 1 }}>
              <Select
                disabled={Boolean(editing?.locked) && !qcMode}
                options={methods.map((m) => ({ label: `${m.name} · ${m.auxiliary} ${m.auxRatio}kg/100kg`, value: m.id }))}
              />
            </Form.Item>
          </Space>

          {watchedHerb ? (
            <Alert
              type={watchedAvailable <= STOCK_EPS ? 'error' : 'info'}
              showIcon
              style={{ marginBottom: 12 }}
              message={
                watchedAvailable <= STOCK_EPS
                  ? `药材「${watchedHerb.name}（${watchedHerb.batchNo}）」余量已清零，不能再投料，请更换有余量的批次`
                  : `药材「${watchedHerb.name}（${watchedHerb.batchNo}）」入库 ${formatKg(watchedHerb.feedKg)}kg，已用 ${formatKg(
                      (stockMap.get(watchedHerb.id)?.usedKg ?? 0) - (editing && watchedHerb.id === editing.herbId ? editing.feedKg : 0),
                    )}kg，本次可投 ${formatKg(watchedAvailable)}kg`
              }
            />
          ) : null}

          {watchedMethod ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={
                <Space wrap size={8}>
                  <span>辅料比例 {watchedMethod.auxRatio}kg/100kg</span>
                  <FireLevelTag level={watchedMethod.fireLevel} tempRange={watchedMethod.tempRange} duration={watchedMethod.duration} />
                  <Tag>{watchedMethod.criterionDimension}</Tag>
                </Space>
              }
              description={`判断标准：${watchedMethod.criterion}；适用药材：${watchedMethod.applicable}`}
            />
          ) : null}

          <RatioCalculator
            auxRatio={watchedMethod?.auxRatio ?? 0}
            auxiliary={watchedMethod?.auxiliary ?? '无'}
            feedKg={Number(watched?.feedKg) || 0}
            auxUsedKg={Number(watched?.auxUsedKg) || 0}
            outputKg={Number(watched?.outputKg) || 0}
            onChange={(patch) => {
              if (patch.feedKg !== undefined) {
                form.setFieldsValue({ feedKg: patch.feedKg } as unknown as BatchFormValues);
              }
              if (patch.auxUsedKg !== undefined) {
                form.setFieldsValue({ auxUsedKg: patch.auxUsedKg } as unknown as BatchFormValues);
              }
            }}
          />

          <Space size={12} style={{ display: 'flex', marginTop: 12 }} align="start">
            <Form.Item name="fireLevel" label="火力" rules={[{ required: true, message: '请选择火力' }]}>
              <Select style={{ width: 120 }} disabled={Boolean(editing?.locked) && !qcMode} options={FIRE_LEVELS.map((v) => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="temp" label="实际锅温(℃)" rules={[{ required: true, message: '请输入实际锅温' }]}>
              <InputNumber min={0} max={800} style={{ width: 140 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="duration" label="炮制时长(min)" rules={[{ required: true, message: '请输入炮制时长' }]}>
              <InputNumber min={0} style={{ width: 140 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="outputKg" label="炮制后重量(kg)" rules={[{ required: true, message: '请输入炮制后重量' }]}>
              <InputNumber min={0} step={0.5} style={{ width: 150 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
          </Space>

          <Form.Item
            name="feedKg"
            label={`投料量(kg)${watchedHerb ? ` · 本次可投 ${formatKg(watchedAvailable)}kg` : ''}`}
            rules={[
              { required: true, message: '请输入投料量' },
              {
                validator: (_, value) => {
                  const feed = Number(value);
                  if (feed !== undefined && feed !== null && feed > watchedAvailable + STOCK_EPS) {
                    return Promise.reject(new Error(`超出余量：该批次最多可投 ${formatKg(watchedAvailable)}kg`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            style={{ maxWidth: 260 }}
          >
            <InputNumber
              min={0}
              max={watchedAvailable > 0 ? Number(watchedAvailable.toFixed(3)) : undefined}
              step={1}
              style={{ width: '100%' }}
              disabled={Boolean(editing?.locked) && !qcMode}
            />
          </Form.Item>

          <Alert
            type={verdict?.degree === '适中' ? 'success' : verdict?.degree === '太过' ? 'error' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`系统判定：${verdict?.degree ?? '待录入火候与得率'}（得率 ${watchedYieldRate}%，预期 ${verdict?.expectedYield ?? '-'}%）`}
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(verdict?.reasons ?? ['选择方法并录入锅温、时长、炮制后重量后自动判定']).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            }
          />

          <Form.Item name="degree" label="程度判定（可按判断标准复核后修改）" rules={[{ required: true, message: '请选择程度' }]}>
            <Select disabled={Boolean(editing?.locked) && !qcMode} options={PROCESS_DEGREES.map((v) => ({ label: v, value: v }))} />
          </Form.Item>

          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="startedAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
              <DatePicker showTime style={{ width: 190 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="endedAt" label="结束时间" rules={[{ required: true, message: '请选择结束时间' }]}>
              <DatePicker showTime style={{ width: 190 }} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
            <Form.Item name="operator" label="操作人" rules={[{ required: true, message: '请输入操作人' }]}>
              <Input style={{ width: 140 }} maxLength={16} disabled={Boolean(editing?.locked) && !qcMode} />
            </Form.Item>
          </Space>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={80} disabled={Boolean(editing?.locked) && !qcMode} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
